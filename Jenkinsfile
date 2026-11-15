// Templates (npm workspaces: Express + Prisma/PostgreSQL API, React web, Playwright) CI pipeline for a Windows Jenkins agent.
// Helpers live in ci/jenkins (Windows PowerShell 5.1 and PowerShell 7 compatible).
// Standard stage order: checkout + source verification, agent prerequisites, locked install + package-manager policy,
// SBOM + dependency audit, disposable test database, validate (format, lint, typecheck, tests, build), built-app smoke,
// template certification, generated-project validation, required browser E2E, report archive.
// This pipeline never publishes or deploys anything unless TRIGGER_LOCAL_STACK_DEPLOY is explicitly enabled on branch new.
pipeline {
  agent any
  options {
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '20'))
    skipDefaultCheckout(true)
    timeout(time: 90, unit: 'MINUTES')
  }
  environment {
    CI = 'true'
    TEMPLATES_PG_PORT = '54329'
    NPM_CONFIG_UPDATE_NOTIFIER = 'false'
    NPM_CONFIG_FUND = 'false'
  }
  parameters {
    booleanParam(name: 'TRIGGER_LOCAL_STACK_DEPLOY', defaultValue: false, description: 'After a green build of branch new, trigger the ASAA-Local-Stack job (local development stack only; the job must exist).')
  }
  stages {
    stage('Checkout and source verification') {
      steps {
        deleteDir()
        script {
          def scmVars = checkout scm
          env.GIT_COMMIT = scmVars.GIT_COMMIT
          env.GIT_BRANCH = scmVars.GIT_BRANCH
        }
        bat 'git --no-pager log -1 --oneline'
        powershell '''
          $ErrorActionPreference = "Stop"
          $head = (git rev-parse HEAD).Trim()
          if ($LASTEXITCODE -ne 0) { throw "git rev-parse failed." }
          if ($head -ne $env:GIT_COMMIT) { throw "Checked-out commit $head does not match the commit Jenkins resolved ($env:GIT_COMMIT)." }
        '''
      }
    }
    stage('Agent prerequisites') {
      steps {
        bat 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ci\\jenkins\\agent-prereqs.ps1 -Require "node,npm,git,lockfile,workspace,postgres" -ReportFile .jenkins-temp\\agent-prereqs.json'
      }
    }
    stage('Install locked dependencies') {
      steps {
        bat 'npm ci'
        bat 'npm run check:pm'
      }
    }
    stage('SBOM and dependency audit') {
      steps {
        bat 'npm run audit:deps'
        // npm sbom cannot run here (npm flags the pinned overrides as an invalid tree), so the SBOM is derived from the lockfile and cross-checked against it.
        bat 'node scripts\\lockfile-sbom.mjs package-lock.json templates-dependencies.cdx.json'
        bat 'node scripts\\sbom-verify.mjs templates-dependencies.cdx.json package-lock.json'
      }
    }
    stage('Prepare disposable test databases') {
      steps {
        bat 'npm run db:local -- init'
        bat 'npm run db:deploy'
        bat 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ci\\jenkins\\test-db.ps1 -Action Migrate'
      }
    }
    stage('Validate, test and build') {
      steps {
        bat 'npm run validate'
      }
    }
    stage('Built-app smoke test') {
      steps {
        bat 'npm run smoke'
      }
    }
    stage('Template certification') {
      steps {
        bat 'npm run certify:templates -w @asaa/api'
      }
    }
    stage('Generated projects install and build') {
      steps {
        bat 'npm run validate:generated'
      }
    }
    stage('Browser E2E (required)') {
      environment {
        PLAYWRIGHT_BROWSERS_PATH = "${env.PLAYWRIGHT_BROWSERS_PATH ?: (env.WORKSPACE + '\\.playwright-browsers')}"
      }
      steps {
        script {
          // Playwright-managed headless Chromium: independent of Edge/Chrome installs and of the service account profile.
          def rc = bat(returnStatus: true, script: 'npx playwright install chromium-headless-shell')
          if (rc != 0) {
            echo "WARNING: could not download the Playwright headless shell (exit ${rc}); the next step still fails the build unless a browser can launch."
          }
        }
        bat 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ci\\jenkins\\agent-prereqs.ps1 -Require "browser" -ReportFile .jenkins-temp\\browser-prereqs.json'
        bat 'npm run test:e2e'
      }
      post {
        always {
          archiveArtifacts artifacts: 'apps/web/playwright-report/**,apps/web/test-results/**,.jenkins-temp/browser-prereqs.json', allowEmptyArchive: true
        }
      }
    }
  }
  post {
    success {
      echo 'Templates CI pipeline passed.'
      script {
        if (params.TRIGGER_LOCAL_STACK_DEPLOY && currentBranchName() == 'new') {
          try {
            build job: 'ASAA-Local-Stack', parameters: [string(name: 'ACTION', value: 'DEPLOY')], wait: false
          } catch (err) {
            echo "WARNING: local stack deployment was requested but could not be triggered: ${err.message}"
            currentBuild.result = 'UNSTABLE'
          }
        } else {
          echo 'No deployment was performed.'
        }
      }
    }
    failure {
      echo 'Templates CI pipeline failed. Review the first failing stage.'
    }
    always {
      archiveArtifacts artifacts: 'templates-dependencies.cdx.json,.local/certification/report.json,.local/generated-validation/report.json,.jenkins-temp/agent-prereqs.json', allowEmptyArchive: true
      bat 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ci\\jenkins\\test-db.ps1 -Action Cleanup'
    }
  }
}

def currentBranchName() {
  def branch = env.BRANCH_NAME ?: env.GIT_BRANCH ?: ''
  return branch.replaceFirst('^refs/heads/', '').replaceFirst('^origin/', '')
}
