const core = require('@actions/core')
const github = require('@actions/github')
const report = require('../report/report')
const inputs = require("./inputs")
const HTTP_STATUS_OK = 200
const HTTP_STATUS_CREATED = 201
const GITHUB_STATE_OPEN = "open"
const GITHUB_STATE_CLOSED = "closed"

function getToken() {
    let token = ""
    let createGithubIssues = inputs.getBoolean(inputs.CX_GITHUB_ISSUES, false)

    if (createGithubIssues && createGithubIssues != "false") {
        token = inputs.getString(inputs.CX_GITHUB_TOKEN, false, "", true)
    } else {
        core.info('Issues will not be created since cxGithubIssues was not provided or set to false')
    }

    return token
}

async function createIssues(repository, commitSha, workspace) {

    let token = getToken()

    if (token) {

        let githubLabels = inputs.getArray(inputs.CX_GITHUB_LABELS, false)
        githubLabels.push("checkmarx")
        let githubAssignees = inputs.getArray(inputs.CX_GITHUB_ASSIGNEES, false)
        let githubMilestone = inputs.getInt(inputs.CX_GITHUB_MILESTONE, false)
        if (githubMilestone == -1) {
            githubMilestone = null
        }

        const repoSplit = repository.split("/")
        const owner = repoSplit[0]
        const repo = repoSplit[1]

        core.info("Getting Octokit...")
        const octokit = github.getOctokit(token)
        if (octokit) {
            let xmlPath = report.getXmlReportPath(workspace)
            let issues = report.getIssuesFromXml(xmlPath, repository, commitSha)
            if (issues) {
                let repositoryIssues = await getIssues(owner, repo, octokit)
                let resolvedIssues = 0
                let reopenedIssues = 0
                let recurrentIssues = 0
                let newIssues = 0
                for (let i = 0; i < issues.length; i++) {
                    let issue = issues[i]
                    
                    const title = report.getTitle(issue)
                    const body = report.getBody(issue)
                    let issueGithubLabels = report.getLabels(githubLabels, issue)


                    let state = GITHUB_STATE_OPEN
                    if (issue.resultState == report.NOT_EXPLOITABLE) {
                        state = GITHUB_STATE_CLOSED
                    }

                    let issueExists = false
                    for (let j = 0; j < repositoryIssues.length; j++) {
                        let repositoryIssue = repositoryIssues[j]
                        const titleRepositoryIssue = repositoryIssue.title
                        if (titleRepositoryIssue == title) {
                            issueExists = true
                            if(state != repositoryIssue.state){
                                if(state == GITHUB_STATE_OPEN && repositoryIssue.state == GITHUB_STATE_CLOSED){
                                    reopenedIssues++
                                } else if(state == GITHUB_STATE_CLOSED && repositoryIssue.state == GITHUB_STATE_OPEN){
                                    resolvedIssues++
                                } else{
                                    recurrentIssues++
                                }
                            } else{
                                recurrentIssues++
                            }
                            await updateIssue(owner, repo, octokit, body, issueGithubLabels, githubAssignees, githubMilestone, repositoryIssue, state)
                            break
                        }
                    }
                    if (!issueExists) {
                        newIssues++
                        let issueId = await createIssue(owner, repo, octokit, title, body, issueGithubLabels, githubAssignees, githubMilestone, i, state)

                        for (let j = 0; j < issue.resultNodes.length; j++) {
                            let node = issue.resultNodes[j]
                            let commentBody = "**#" + issueId + " - " + issue.resultSeverity + " - " + issue.queryName + " - " + j + " Node** - " + node.name
                            await createCommitComment(owner, repo, octokit, commitSha, commentBody, node.relativefileName, node.line)
                        }
                        issueGithubLabels = []
                    }
                }

                let summary = report.getSummary(issues, newIssues, recurrentIssues, resolvedIssues, reopenedIssues)
                await createCommitComment(owner, repo, octokit, commitSha, summary, null, null)
            }
        } else {
            core.info("Unable to authenticate to octokit. Please provide a proper GITHUB_TOKEN")
        }
    } else {
        core.info('No issues will be created')
    }
}

async function getIssues(owner, repo, octokit) {
    core.info("\nGetting Issues from " + owner + "/" + repo)
    let issues = []
    for (let i = 0; i < 1000000; i++) {//TODO Find a better way to get total number of pages for issues
        let res = await octokit.issues.listForRepo({
            owner: owner,
            repo: repo,
            state: "all",
            page: i
        })
        if (res.status == HTTP_STATUS_OK) {
            issues = issues.concat(res.data)
            if (res.data.length < 30) {
                break
            }
        } else {
            core.info("Cannot retrieve issues page " + i + " from " + owner + "/" + repo)
            return issues
        }
    }
    return issues
}

async function updateIssue(owner, repo, octokit, body, githubLabels, githubAssignees, githubMilestone, repositoryIssue, state) {

    core.info("\nUpdating ticket #" + repositoryIssue.number + " for " + owner + "/" + repo)
    let uniqueLabels = githubLabels
    for (let i = 0; i < repositoryIssue.labels.length; i++) {
        const label = repositoryIssue.labels[i].name
        if (!uniqueLabels.includes(label)) {
            uniqueLabels.push(label)
        }
    }
    let uniqueAssignees = githubAssignees
    for (let i = 0; i < repositoryIssue.assignees.length; i++) {
        const assignee = repositoryIssue.assignees[i].login
        if (!uniqueAssignees.includes(assignee)) {
            uniqueAssignees.push(assignee)
        }
    }

    const issueUpdated = await octokit.issues.update({
        owner: owner,
        repo: repo,
        issue_number: repositoryIssue.number,
        title: repositoryIssue.title,
        body: repositoryIssue.body,
        state: state,
        milestone: githubMilestone,
        labels: uniqueLabels,
        assignees: uniqueAssignees
    })
    if (issueUpdated.status == HTTP_STATUS_OK) {
        const issueCommented = await octokit.issues.createComment({
            owner: owner,
            repo: repo,
            issue_number: repositoryIssue.number,
            body: body
        })
        if (issueCommented.status == HTTP_STATUS_CREATED) {
            core.info("New Comment was Created for Issue #" + repositoryIssue.number + " for " + owner + "/" + repo)
            return issueCommented.data
        } else {
            core.info("Cannot Create Comment for issue #" + repositoryIssue.number + " from " + owner + "/" + repo)
            return issueCommented.data
        }
    } else {
        core.info("Cannot update issue #" + repositoryIssue.number + " from " + owner + "/" + repo)
        return issueUpdated.data
    }
}

async function createIssue(owner, repo, octokit, title, body, githubLabels, githubAssignees, githubMilestone, id, state) {
    core.info("\nCreating ticket #" + id + " for " + owner + "/" + repo)
    let issueCreated = await octokit.issues.create({
        owner: owner,
        repo: repo,
        title: title,
        body: body,
        assignees: githubAssignees,
        labels: githubLabels,
        milestone: githubMilestone
    })
    if (issueCreated.status == HTTP_STATUS_CREATED) {
        const issueId = issueCreated.data.number
        const issueUrl = issueCreated.data.html_url
        core.info("Ticket #" + issueId + " was Created for " + owner + "/" + repo)
        core.info(issueUrl)

        const issueUpdated = await octokit.issues.update({
            owner: owner,
            repo: repo,
            issue_number: issueId,
            title: title,
            body: body,
            state: state,
            milestone: githubMilestone,
            labels: githubLabels,
            assignees: githubAssignees
        })
        if (issueUpdated.status == HTTP_STATUS_OK) {
            core.info("Update State of Issue #" + issueId + " from " + owner + "/" + repo)
            return issueId
        } else {

            core.info("Cannot update issue #" + issueId + " from " + owner + "/" + repo)
            return issueId
        }
    } else {
        core.info("Ticket #" + id + " failed to be Created for " + owner + "/" + repo)
        return false
    }
}

async function createCommitComment(owner, repo, octokit, commitSha, body, path, position) {
    core.info("\nCreating Comment with Checkmarx Summary for Commit #" + commitSha + " for " + owner + "/" + repo)
    const commitCommentCreated = await octokit.repos.createCommitComment({
        owner: owner,
        repo: repo,
        commit_sha: commitSha,
        body: body,
        path: path,
        position: position
    })
    if (commitCommentCreated.status == HTTP_STATUS_CREATED) {
        const commentUrl = commitCommentCreated.data.html_url
        core.info("New Comment was Created for Commit #" + commitSha + " for " + owner + "/" + repo)
        core.info(commentUrl)
        return true
    } else {
        core.info("New Comment failed to be created for Commit #" + commitSha + " for " + owner + "/" + repo)
        return false
    }
}

module.exports = {
    createIssues: createIssues,
    createIssue: createIssue,
    updateIssue: updateIssue,
    createCommitComment: createCommitComment
}