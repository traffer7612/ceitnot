/**
 * Aura Protocol — Defender Autotask: Alert Webhook Relay
 * -------------------------------------------------------
 * Triggered by any Defender Monitor (Sentinel) alert.
 * Relays alert details to an external webhook (e.g. PagerDuty, Slack, Discord).
 *
 * Deploy via Defender Dashboard > Autotasks > Create Autotask
 * Set the following Defender Secrets:
 *   WEBHOOK_URL         - Target webhook endpoint
 *   PAGERDUTY_KEY       - (Optional) PagerDuty Events API v2 routing key
 *   SLACK_WEBHOOK_URL   - (Optional) Slack Incoming Webhook URL
 *
 * Attach this Autotask as the action in each Monitor's "Autotask trigger".
 */

const { KeyValueStoreClient } = require('@openzeppelin/defender-kvstore-client');
const axios = require('axios');

// Severity mapping by alert name keyword
function severityFromName(name) {
    const n = (name || '').toLowerCase();
    if (n.includes('emergency') || n.includes('circuit'))  return 'critical';
    if (n.includes('liquidation') || n.includes('oracle')) return 'error';
    if (n.includes('pause') || n.includes('admin'))        return 'warning';
    return 'info';
}

exports.handler = async function(payload) {
    const { notificationClient, secrets, request } = payload;

    const webhookUrl       = secrets.WEBHOOK_URL;
    const pagerDutyKey     = secrets.PAGERDUTY_KEY;
    const slackWebhookUrl  = secrets.SLACK_WEBHOOK_URL;

    // Defender passes the monitor match in request.body
    const match    = request?.body?.value || request?.body || {};
    const sentinel = match.sentinel || {};
    const txHash   = match.transaction?.hash || 'unknown';
    const network  = sentinel.network || 'unknown';
    const name     = sentinel.name    || 'Aura Alert';
    const severity = severityFromName(name);

    const summary = `[${severity.toUpperCase()}] ${name} on ${network}`;
    const details = JSON.stringify(match, null, 2);

    console.log(summary);
    console.log('Transaction:', txHash);

    const errors = [];

    // ── Generic webhook ───────────────────────────────────────────────────────
    if (webhookUrl) {
        try {
            await axios.post(webhookUrl, {
                summary,
                severity,
                network,
                txHash,
                details: match,
                timestamp: new Date().toISOString(),
            });
            console.log('Generic webhook delivered.');
        } catch (e) {
            errors.push(`Webhook error: ${e.message}`);
        }
    }

    // ── PagerDuty Events API v2 ───────────────────────────────────────────────
    if (pagerDutyKey) {
        try {
            await axios.post('https://events.pagerduty.com/v2/enqueue', {
                routing_key: pagerDutyKey,
                event_action: severity === 'critical' ? 'trigger' : 'trigger',
                dedup_key: `aura-${txHash}`,
                payload: {
                    summary,
                    severity,
                    source: `aura-${network}`,
                    custom_details: match,
                },
                links: [{
                    href: `https://arbiscan.io/tx/${txHash}`,
                    text: 'View on Arbiscan',
                }],
            });
            console.log('PagerDuty alert sent.');
        } catch (e) {
            errors.push(`PagerDuty error: ${e.message}`);
        }
    }

    // ── Slack Incoming Webhook ────────────────────────────────────────────────
    if (slackWebhookUrl) {
        const emoji = severity === 'critical' ? ':rotating_light:' : ':warning:';
        try {
            await axios.post(slackWebhookUrl, {
                text: `${emoji} *${summary}*`,
                blocks: [
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: `${emoji} *${summary}*\nNetwork: \`${network}\`\nTx: \`${txHash}\``,
                        },
                    },
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: `\`\`\`${JSON.stringify(match, null, 2).slice(0, 1500)}\`\`\``,
                        },
                    },
                ],
            });
            console.log('Slack notification sent.');
        } catch (e) {
            errors.push(`Slack error: ${e.message}`);
        }
    }

    if (errors.length > 0) {
        throw new Error(errors.join('; '));
    }
};
