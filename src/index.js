const utils = require('./utils.js')
const cxcli = require('./cxcli.js')
const cxtoken = require('./cxtoken.js')
const cxsast = require('./cxsast.js')
const cxosa = require('./cxosa.js')
const core = require('@actions/core')
const github = require('@actions/github')
let action = "Scan"
let version = "8.9"
let server
let verbose = true

async function run() {
    try {
        core.info('Event name: ' + github.context.eventName)
        core.info('Repository : ' + GITHUB_REPOSITORY)
        core.info('Branch : ' + GITHUB_REF)
        core.info('Workspace : ' + GITHUB_WORKSPACE)
        core.info('Commit SHA : ' + GITHUB_SHA)

        core.info("\n[START] Read Inputs...")

        let cxAction = core.getInput('cxAction')
        let cxServer = core.getInput('cxServer')

        if (utils.isValidAction(cxAction)) {
            action = cxAction
        } else {
            core.warning('"cxAction" not provided')
            core.info('Default Action will be used: ' + action)
        }

        if (utils.isValidUrl(cxServer)) {
            core.info('cxServer: ' + cxServer)
            server = cxServer.trim()
        } else {
            core.setFailed("Please provide 'cxServer' input (string - HTTPS should be used): " + cxServer)
            return
        }

        let command = "./" + cxcli.getFolderName() + "/runCxConsole.sh "
        let auxCommand = ""

        switch (action) {
            case "Scan":
                auxCommand = await cxsast.getSastCmd(server, action)
                break
            case "AsyncScan":
                auxCommand = await cxsast.getSastCmd(server, action)
                break
            case "OsaScan":
                auxCommand = await cxosa.getOsaCmd(server, action)
                break
            case "AsyncOsaScan":
                auxCommand = await cxosa.getOsaCmd(server, action)
                break
            case "RevokeToken":
                auxCommand = await cxtoken.revokeTokenGetCmd(server)
                break
            case "GenerateToken":
                auxCommand = await cxtoken.generateTokenGetCmd(server)
                break
            default:
                auxCommand = await cxsast.getSastCmd(server, "Scan")
                break
        }

        if (utils.isValidString(auxCommand)) {
            command += auxCommand
        } else {
            core.setFailed("Invalid auxCommand : " + auxCommand)
            return
        }

        let cxVerbose = core.getInput('cxVerbose')

        if (utils.isBoolean(cxVerbose)) {
            core.info('cxVerbose: ' + cxVerbose)
            verbose = Boolean(cxVerbose)
        } else {
            core.warning('Verbose valid flag not provided')
            verbose = true
        }

        if (verbose) {
            command += " -v"
        }

        let cxVersion = core.getInput('cxVersion')

        if (utils.isValidVersion(cxVersion)) {
            core.info('cxVersion: ' + cxVersion)
            version = cxVersion.trim()
        } else {
            core.warning("No 'cxVersion' valid input provided : " + version + " version will be used")
        }

        core.info("[END] Read Inputs...\n")

        await cxcli.downloadCli(version)

        await cxcli.executeCommand(command)
    } catch (error) {
        core.setFailed(error.message)
    }
}

run()

module.exports = {
    run: run
}