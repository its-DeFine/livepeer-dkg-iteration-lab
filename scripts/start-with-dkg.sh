#!/usr/bin/env sh
set -eu

dkg_pid=""

redact_logs() {
  sed -E 's/(private|mnemonic|secret|seed|token|password|key).*/\1 [redacted]/Ig'
}

stop_dkg() {
  if [ -n "${dkg_pid}" ] && kill -0 "${dkg_pid}" 2>/dev/null; then
    dkg stop >/tmp/dkg-stop.log 2>&1 || kill "${dkg_pid}" 2>/dev/null || true
  fi
}

trap stop_dkg INT TERM EXIT

if [ "${DKG_MODE:-file}" = "cli" ]; then
  export DKG_HOME="${DKG_HOME:-/dkg-home}"

  if [ ! -f "${DKG_HOME}/config.json" ]; then
    echo "DKG_MODE=cli but ${DKG_HOME}/config.json is missing." >&2
    echo "Run ./scripts/init-dkg-volume.sh before docker compose up." >&2
    exit 1
  fi

  dkg start --foreground >/tmp/dkg-daemon.log 2>&1 &
  dkg_pid="$!"

  ready="0"
  timeout_seconds="${DKG_STARTUP_TIMEOUT_SECONDS:-120}"
  for _ in $(seq 1 "${timeout_seconds}"); do
    if dkg status >/tmp/dkg-status.log 2>&1; then
      ready="1"
      break
    fi

    if ! kill -0 "${dkg_pid}" 2>/dev/null; then
      echo "DKG daemon exited before it became ready." >&2
      tail -80 /tmp/dkg-daemon.log 2>/dev/null | redact_logs >&2 || true
      exit 1
    fi

    sleep 1
  done

  if [ "${ready}" != "1" ]; then
    echo "DKG daemon did not become ready within ${timeout_seconds}s." >&2
    tail -80 /tmp/dkg-daemon.log 2>/dev/null | redact_logs >&2 || true
    exit 1
  fi
fi

node dist/server/index.js
