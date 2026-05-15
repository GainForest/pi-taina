# Accessing Devices via Tailscale

The gainforest tailnet provides SSH access to the Pi-Tainá Raspberry Pis from anywhere — no port forwarding, no VPN, no Pi Connect required.

## Devices

| Hostname | OS user |
|---|---|
| `gainforest-002` | `team_gainforest` |
| `gainforest-003` | `team_gainforest` |
| `gainforest-004` | `team_gainforest` |

The Pis are tagged `tag:pi` on the tailnet. The ACL restricts network access to `taina@gainforest.net` and `diego@gainforest.net`.

## Prerequisites

1. Install [Tailscale](https://tailscale.com/download) on your Mac and sign in to the gainforest.net tailnet.
2. Confirm the Pis are reachable:

   ```bash
   tailscale status | grep gainforest-00
   ```

   You should see each Pi listed as `tagged-devices`.

## Connect

Plain SSH — MagicDNS resolves the hostname over the tailnet:

```bash
ssh team_gainforest@gainforest-002
```

One-off command:

```bash
ssh team_gainforest@gainforest-002 "<command>"
```

File transfer:

```bash
scp ./file.txt team_gainforest@gainforest-002:~/
```

## Check the taina service

```bash
ssh team_gainforest@gainforest-002 \
  "sudo systemctl status taina --no-pager && journalctl -u taina -n 40 --no-pager"
```

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `tailscale: failed to look up local user` | Wrong username | Use `team_gainforest`. To confirm, run `whoami` on the Pi via Raspberry Pi Connect. |
| Device shows `offline` in `tailscale status` | Pi is off or has lost its network | Power-cycle the Pi or check Wi-Fi/Ethernet. |
| `Permission denied` / connection refused | ACL doesn't allow your account | Make sure your Mac's Tailscale is signed in as `taina@gainforest.net` or `diego@gainforest.net`. |
| Can't see the Pis in `tailscale status` | Mac not on the gainforest tailnet | `tailscale up` and sign in with a gainforest.net account. |
| First-connection prompt | Tailscale SSH identity check | Click the URL it prints; one-time per device. |

## Fallback

Raspberry Pi Connect remains enabled on all three Pis as a browser-based fallback (terminal + screen share). Use it if Tailscale is ever unavailable or for graphical sessions.

## Adding a new Pi

On the Pi (via Raspberry Pi Connect for the first session):

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh --advertise-tags=tag:pi --hostname=gainforest-00X
```

Authenticate in the browser as `taina@gainforest.net` (the `tag:pi` owner). Then verify from a Mac with `tailscale status`.
