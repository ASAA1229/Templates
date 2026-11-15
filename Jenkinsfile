pipeline {
  agent any
  options {
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '20'))
    skipDefaultCheckout(true)
  }
  environment {
    CI = 'true'
    TEMPLATES_PG_PORT = '54329'
  }
  stages {
    stage('Checkout') {
      steps {
        deleteDir()
        checkout scm
      }
    }
    stage('Agent prerequisites') {
      steps {
        bat 'node --version'
        bat 'npm --version'
        bat 'git --version'
        powershell '''
          $ErrorActionPreference = "Stop"
          foreach ($commandName in @("initdb", "pg_ctl", "psql")) {
            if (-not (Get-Command $commandName -ErrorAction SilentlyContinue)) {
              throw "Required PostgreSQL command '$commandName' was not found on this Jenkins agent."
            }
          }
        '''
      }
    }
    stage('Install locked dependencies') {
      steps {
        bat 'npm ci'
        bat 'npm run check:pm'
        bat 'npm run audit:deps'
        bat 'npm sbom --sbom-format=cyclonedx --output-file=templates-dependencies.cdx.json'
      }
    }
    stage('Prepare disposable test databases') {
      steps {
        bat 'npm run db:local -- init'
        bat 'npm run db:deploy'
        powershell '''
          $ErrorActionPreference = "Stop"
          $envLines = Get-Content "apps/api/.env"
          $testDatabaseLine = $envLines | Where-Object { $_ -match "^TEST_DATABASE_URL=" } | Select-Object -First 1
          if (-not $testDatabaseLine) {
            throw "TEST_DATABASE_URL was not generated in apps/api/.env."
          }
          $testDatabaseMatch = [regex]::Match($testDatabaseLine, '^TEST_DATABASE_URL="?([^"]+)"?$')
          if (-not $testDatabaseMatch.Success) {
            throw "TEST_DATABASE_URL in apps/api/.env has an unexpected format."
          }
          try {
            $env:DATABASE_URL = $testDatabaseMatch.Groups[1].Value
            npm run db:deploy -w @asaa/api
            if ($LASTEXITCODE -ne 0) {
              throw "Applying migrations to the disposable test database failed."
            }
          } finally {
            Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
          }
        '''
      }
    }
    stage('Validate, test and build') {
      steps {
        bat 'npm run validate'
        bat 'npm run validate:generated'
      }
    }
  }
  post {
    success {
      echo 'Templates CI pipeline passed. No deployment was performed.'
      script {
        def branchName = env.BRANCH_NAME ?: env.GIT_BRANCH ?: ''
        if (branchName == 'new' || branchName.endsWith('/new')) {
          build job: 'ASAA-Local-Stack',
            parameters: [string(name: 'ACTION', value: 'DEPLOY')],
            wait: false
        }
      }
    }
    failure {
      echo 'Templates CI pipeline failed. Review the first failing stage.'
    }
    always {
      powershell '''
        $ErrorActionPreference = "Stop"
        if (Test-Path ".local/pgdata" -PathType Container) {
          npm run db:local -- stop
          if ($LASTEXITCODE -ne 0) {
            throw "Stopping the disposable PostgreSQL cluster failed."
          }
          Remove-Item -Recurse -Force -LiteralPath ".local"
        }
        if (Test-Path "apps/api/.env" -PathType Leaf) {
          Remove-Item -Force -LiteralPath "apps/api/.env"
        }
      '''
      archiveArtifacts artifacts: 'templates-dependencies.cdx.json', allowEmptyArchive: true
    }
  }
}
