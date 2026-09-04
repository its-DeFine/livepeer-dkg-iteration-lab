#!/usr/bin/env sh
set -eu

volume_name="${DKG_DOCKER_VOLUME:-iteration-lab-dkg-home}"
dkg_version="${DKG_NPM_VERSION:-10.0.14}"

docker volume create "${volume_name}" >/dev/null

cat <<MSG
Initializing local DKG home volume: ${volume_name}

Recommended prompt answers for this demo:
- Node name: iteration-lab-edge
- Triple store backend: press Enter for oxigraph
- Relay/context graph/API port: press Enter for defaults
- Auto-update: n
- API authentication: n

The app uses local / Shared Working Memory. It does not publish to Verifiable Memory unless you run a publish command separately.
MSG

exec docker run -it --rm   -v "${volume_name}:/dkg-home"   -e DKG_HOME=/dkg-home   -e HOME=/tmp/dkg-user-home   node:22-alpine sh -lc "npm install -g @origintrail-official/dkg@${dkg_version} >/tmp/dkg-install.log 2>&1 && dkg init --role edge --network testnet --store oxigraph"
