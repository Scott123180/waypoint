# Contract: `intelligence.md`

**Feature**: 008-llm-assisted-inbox-organization

The one setting a user changes when they move between machines. It lives in the git-tracked data directory
beside `policy.md` and `identity.md`, in the shapes those files already use, and it never holds a secret.

**Vault-relative path**: `intelligence.md`

---

## Format

Read with `readField` and `readListSection` from `vault/preamble.ts` — the same helpers `identity.md` uses, so
the file reads with the mental model the user already has. Keys are case-insensitive and tolerant of the
spacing a hand-edit produces.

### At home — a command-line tool

```markdown
# Intelligence

transport: command
command: claude

## Arguments

- -p
- --output-format
- text
```

The request is written to the tool's **stdin** and the response read from its **stdout**. Arguments are passed
in list order. A `## Arguments` list rather than a space-separated field because splitting on spaces is lossy
for an argument that contains one, and because `identity.md`'s `## Aliases` already teaches that a list of
things is a list section.

### At work — a certificate-authenticated endpoint

```markdown
# Intelligence

transport: certificate
endpoint: https://llm.corp.example/v1/messages
certificate: /home/me/.certs/waypoint-client.pem
key: /home/me/.certs/waypoint-client.key
ca: /etc/ssl/corp/root.pem
```

`ca` is optional and needed only for a privately-issued server certificate.

---

## Fields

| Key | Transport | Required | Value |
|---|---|---|---|
| `transport` | — | yes | `command` or `certificate`. Anything else is a problem. |
| `command` | `command` | yes | Absolute path, or a bare name resolved by the platform. |
| `## Arguments` | `command` | no | List, passed in order. Absent means none. |
| `endpoint` | `certificate` | yes | An `https://` URL. `http://` is refused. |
| `certificate` | `certificate` | yes | **Path** to the client certificate. |
| `key` | `certificate` | yes | **Path** to the private key. |
| `ca` | `certificate` | no | **Path** to a trust anchor. |

---

## Absent means off, silently

No file, or a file with no `transport:` line, is the shipped state and the state of every vault that exists
today. The layer is off; no problem is reported, no prompt is shown, no affordance is rendered, and nothing in
sorting changes (FR-054, FR-060).

This is deliberately not a first-run experience. A user who has never heard of this feature must never learn
of it by being asked to configure it.

---

## A problem is reported, and blocks nothing

| Situation | Message names | Result |
|---|---|---|
| `transport: copilot` | the value read, and `command` and `certificate` as the values that work | layer off |
| `transport: certificate` with no `endpoint:` | the missing key and the transport that needs it | layer off |
| `endpoint: http://…` | that HTTPS is required | layer off |

One problem, in the notice shape the vault's other configuration problems already use, reported once when the
file is read. Sorting, capture, projects, the review, and the retrospective are unaffected (FR-055).

**Per-file, not per-value.** `policy.md` falls back per value, because a typo in one rule must not silently
restore a different default for another. Here the opposite is right: a transport missing its endpoint cannot
be half-used, and falling back to some other transport would be the environment-probing FR-052 forbids. The
layer goes off, and the user is told which line to fix.

---

## Nothing here is secret, and nothing here can become secret

`certificate`, `key`, and `ca` are **paths**. There is no field whose value is key material, so a private key
cannot be written into this file by a user following the format — which is what makes "the data directory
stays safe to commit" a property of the format rather than a warning (FR-051b).

The paths are resolved and read **by the transport, at call time**, never at parse time (FR-051c). Three
consequences, all intended:

- A vault committed and pushed carries a command, an address, and a path. Nothing secret travels with it.
- A vault opened on a machine where the credential is not installed produces a `credential` failure on the
  first request — reported, not silent — and sorting is untouched.
- A message about a credential names the **path** and the problem, never the material (FR-051d).

---

## Never probed, ever

The transport comes from this file or the layer is off. The application must not check `PATH` for a
command-line tool, probe for a listening local model, read an environment variable, or detect an editor host
(FR-052).

The reason is the one the roadmap gives: auto-detection makes the application behave differently on two
machines for reasons the user cannot see, which is exactly what plain-text configuration stored with the data
exists to prevent. A machine with `claude` on `PATH`, an Ollama listening on `11434`, and no
`intelligence.md` has the layer **off** — and there is a test that says so.

---

## Changing machines

Change `transport:` and the parameters that go with it. Nothing else in the data directory changes, and
nothing about what is proposed, how it is presented, or how it is accepted changes with it (FR-050, FR-053,
SC-009).

---

## Not in this file

- **No timeout.** 120 seconds, in core, the same for every transport, not configurable (FR-066a). A knob here
  would be a setting the user has to understand before the feature works.
- **No model name, temperature, or prompt override.** The default intelligence module owns how it thinks; the
  transport owns how it is reached. A prompt override would be a second intelligence module wearing a
  configuration file.
- **No enable/disable flag.** The presence of a transport *is* the enablement. A separate flag would create a
  fourth state — configured but off — that nothing needs.
- **No second transport as a fallback.** Falling back is a choice the user did not make, and on a work machine
  the fallback is the one that is blocked.
