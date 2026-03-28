#!/bin/sh
# Workaround for NVIDIA OpenShell cluster image v0.0.16 bug.
# The original entrypoint passes --resolv-conf to k3s, but k3s v1.35.2
# removed that flag. This wrapper runs the original entrypoint's setup
# (DNS proxy, registry config, manifests, etc.) then starts k3s without
# the incompatible flag.
#
# The original entrypoint writes the correct resolv.conf to
# /etc/rancher/k3s/resolv.conf before the final exec. In k3s v1.31+,
# the resolv.conf is auto-detected from that path, so the explicit flag
# is not needed.

set -e

# Run the original entrypoint with a no-op k3s binary that exits 0,
# so all the DNS/registry/manifest setup runs but k3s doesn't start.
# We use "true" as a fake k3s to absorb the arguments.
mv /bin/k3s /bin/k3s.real

cat > /bin/k3s <<'FAKE_K3S'
#!/bin/sh
exit 0
FAKE_K3S
chmod +x /bin/k3s

# Run the original entrypoint (it will call our fake k3s which exits cleanly)
/usr/local/bin/cluster-entrypoint.sh "$@" || true

# Restore the real k3s binary
mv /bin/k3s.real /bin/k3s

# Detect cgroup version (same logic as original entrypoint)
EXTRA_KUBELET_ARGS=""
if [ ! -f /sys/fs/cgroup/cgroup.controllers ]; then
    echo "Detected cgroup v1 -- adding kubelet compatibility flag (fail-cgroupv1=false)"
    EXTRA_KUBELET_ARGS="--kubelet-arg=fail-cgroupv1=false"
fi

# Wait for default route (same logic as original entrypoint)
wait_for_route() {
    attempts=${1:-30}
    delay_s=${2:-1}
    i=1
    while [ "$i" -le "$attempts" ]; do
        if ip -4 route show default 2>/dev/null | grep -q '^default ' \
            || ip -6 route show default 2>/dev/null | grep -q '^default '; then
            return 0
        fi
        sleep "$delay_s"
        i=$((i + 1))
    done
    echo "Warning: no default route present"
    return 1
}

wait_for_route

echo "Starting k3s server (without --resolv-conf, auto-detected by k3s v1.31+)"
# shellcheck disable=SC2086
exec /bin/k3s "$@" $EXTRA_KUBELET_ARGS
