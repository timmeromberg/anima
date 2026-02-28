# 08 — Error Model

> Anima Language Specification v0.1.0

## Overview

Anima's error model extends Kotlin's sealed class hierarchy with **diagnosable errors** — errors that can analyze their own root cause, suggest fixes, and optionally self-heal.

## Standard Error Handling

Anima uses Kotlin-style sealed hierarchies and `Result` types:

```anima
sealed class AppError {
    data class NotFound(val resource: String, val id: ID) : AppError()
    data class Unauthorized(val user: User, val action: String) : AppError()
    data class ServiceDown(val service: String) : AppError()
    data class Unknown(val cause: Throwable) : AppError()
}

fun getUser(id: ID): Result<User> {
    val user = database.users.find(id)
        ?: return Err(NotFound("User", id))
    return Ok(user)
}

// Pattern matching on results
when (val result = getUser(userId)) {
    is Ok -> display(result.value)
    is Err -> handleError(result.error)
}
```

## Diagnosable Errors

Diagnosable errors can analyze their own root cause:

```anima
diagnosable class ConnectionRefused(
    val host: String,
    val port: Int
) : AppError() {

    diagnose {
        check { portInUse(port) }
            yields "Port $port is occupied by ${processOn(port)}"

        check { firewallBlocks(host, port) }
            yields "Firewall is blocking $host:$port"

        check { dnsResolves(host) }
            yields "DNS resolution for $host: ${resolve(host)}"

        check { serviceRunning(host) }
            yields "Service status on $host: ${pingService(host)}"
    }

    suggest {
        "Start the service: systemctl start ${inferServiceName(host)}"
        "Use alternative port: update config.port to ${findFreePort()}"
        "Check network connectivity: ping $host"
    }

    autoFix(requiresApproval = true) {
        attempt { startService(inferServiceName(host)) }
        verify { canConnect(host, port) }
    }
}
```

### Using Diagnosable Errors

```anima
when (val result = connectToService("api.internal", 8080)) {
    is Ok -> result.value.send(request)
    is Err -> {
        val diagnosis = result.error.diagnose()
        logger.error("Connection failed: ${diagnosis.summary}")

        // Show structured diagnosis
        diagnosis.findings.forEach { finding ->
            logger.info("  ${finding.check}: ${finding.result}")
        }

        // Show suggestions
        diagnosis.suggestions.forEach { suggestion ->
            logger.info("  Suggestion: $suggestion")
        }

        // Attempt auto-fix (if authorized)
        if (diagnosis.canAutoFix) {
            val fixed = diagnosis.autoFix()
            if (fixed) {
                logger.info("Auto-fix successful, retrying...")
                retry()
            }
        }
    }
}
```

## Diagnosis Structure

```anima
data class Diagnosis(
    val error: AppError,
    val findings: List<Finding>,          // what was checked and found
    val rootCause: String @ Confidence,   // best guess at root cause
    val suggestions: List<String>,        // human-readable suggestions
    val canAutoFix: Boolean,              // whether auto-fix is available
    val autoFixRequiresApproval: Boolean  // whether human must approve
)

data class Finding(
    val check: String,       // what was checked
    val result: String,      // what was found
    val relevant: Boolean    // whether this is likely the root cause
)
```

## Error Adaptation in Intents

Intent functions handle errors through `adapt` blocks:

```anima
intent fun fetchData(source: DataSource): Dataset {
    ensure { output.conforms(schema) }

    adapt<ConnectionTimeout> {
        retry(maxAttempts = 3, backoff = exponential(base = 1.seconds))
    }

    adapt<SchemaViolation> { violation ->
        val fixed = autoFix(violation.record, schema)
        if (fixed != null) use(fixed) else skip(violation.record)
    }

    adapt<RateLimited> { error ->
        delay(error.retryAfter)
        retry()
    }

    // Catch-all adaptation
    adapt<AppError> { error ->
        val diagnosis = error.diagnose()
        if (diagnosis.canAutoFix) {
            diagnosis.autoFix()
            retry()
        } else {
            escalate("Unrecoverable: ${diagnosis.summary}")
        }
    }
}
```

## Error Confidence

Errors themselves can carry confidence — useful when the error classification is uncertain:

```anima
fun classifyError(response: HttpResponse): AppError @ Confidence {
    return when (response.status) {
        404 -> NotFound(response.url) @ 0.99       // very confident
        403 -> Unauthorized(currentUser) @ 0.95     // confident
        500 -> {
            // Could be many things — diagnose
            val diagnosis = analyzeServerError(response.body)
            diagnosis.mostLikelyError @ diagnosis.confidence
        }
        else -> Unknown(response) @ 0.5             // uncertain
    }
}
```

## Comparison with Traditional Error Handling

| Feature | Traditional | Anima |
|---------|-------------|-------|
| Error type | String message or error code | Typed sealed hierarchy |
| Root cause | Developer must investigate | `diagnose` block analyzes automatically |
| Suggestions | None | `suggest` block provides actionable advice |
| Self-healing | None | `autoFix` block with governance |
| Confidence | Binary (error or not) | Errors carry confidence scores |
| Adaptation | try/catch | `adapt<T>` with typed recovery |
