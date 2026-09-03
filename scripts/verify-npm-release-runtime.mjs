#!/usr/bin/env node
import { writeFileSync } from "node:fs"

import {
  NPM_RELEASE,
  canonicalJson,
  validateAnnotatedTag,
  validateProtectedApproval,
} from "./npm-release-contract.mjs"

function required(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

async function github(path) {
  const response = await fetch(`https://api.github.com/repos/${NPM_RELEASE.repository}${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${required("GITHUB_TOKEN")}`,
      "user-agent": "bharatcode-cli-release-gate",
      "x-github-api-version": "2022-11-28",
    },
  })
  if (!response.ok) throw new Error(`GitHub release evidence request failed (${response.status})`)
  return response.json()
}

async function currentTag(sourceSha, admittedTagObjectSha = null) {
  const ref = await github(`/git/ref/tags/${encodeURIComponent(NPM_RELEASE.tag)}`)
  const expectedTagObjectSha = admittedTagObjectSha || ref?.object?.sha || "missing"
  if (ref?.object?.type !== "tag") {
    validateAnnotatedTag(ref, null, {
      admitted_tag_object_sha: expectedTagObjectSha,
      source_sha: sourceSha,
      tag: NPM_RELEASE.tag,
    })
  }
  const tagObject = await github(`/git/tags/${encodeURIComponent(ref.object.sha)}`)
  return validateAnnotatedTag(ref, tagObject, {
    admitted_tag_object_sha: expectedTagObjectSha,
    source_sha: sourceSha,
    tag: NPM_RELEASE.tag,
  })
}

async function main() {
  const sourceSha = required("SOURCE_SHA")
  const mode = process.argv[2]

  if (mode === "--tag-only") {
    const tag = await currentTag(sourceSha)
    process.stdout.write(tag.tag_object_sha)
    return
  }

  const runId = required("GITHUB_RUN_ID")
  const runAttempt = required("GITHUB_RUN_ATTEMPT")
  const environment = required("RELEASE_ENVIRONMENT")
  const reviewer = required("REQUIRED_REVIEWER")
  const admittedTagObjectSha = required("ADMITTED_TAG_OBJECT_SHA")
  const subjectSha256 = required("RELEASE_SUBJECT_SHA256")
  if (!/^[0-9a-f]{64}$/u.test(subjectSha256)) throw new Error("release subject SHA-256 is invalid")
  const [run, approvals, commit] = await Promise.all([
    github(`/actions/runs/${encodeURIComponent(runId)}`),
    github(`/actions/runs/${encodeURIComponent(runId)}/approvals`),
    github(`/commits/${encodeURIComponent(sourceSha)}`),
  ])
  const approval = validateProtectedApproval(
    { approvals, commit, run },
    { environment, reviewer, run_attempt: runAttempt, run_id: runId, source_sha: sourceSha },
  )
  const tag = await currentTag(sourceSha, admittedTagObjectSha)
  const receipt = {
    ...approval,
    repository: NPM_RELEASE.repository,
    schema: "bharatcode-cli-runtime-release-gate-v1",
    subject_sha256: subjectSha256,
    tag: tag.tag,
    tag_object_sha: tag.tag_object_sha,
    validated_at: new Date().toISOString(),
    workflow: NPM_RELEASE.workflow,
  }
  writeFileSync(required("RELEASE_GATE_RECEIPT"), canonicalJson(receipt), { mode: 0o600 })
  process.stdout.write(`Validated ${environment} approval and annotated release tag.\n`)
}

main().catch((error) => {
  console.error(`release gate: ${error.message}`)
  process.exitCode = 1
})
