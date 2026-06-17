-- ── WYWA email template ───────────────────────────────────────────────
-- Adds the 'while_you_were_away' row to email_templates so the admin
-- WYWAEmailAdmin component (re-engagement send) can pick it up via the
-- existing admin-send-email Netlify function. The function looks the
-- template up by primary-key id (.eq('id', type)), so the id column is
-- the template's stable key — matching the existing pattern used by
-- 'congratulations', 'reengagement', and 'invite'.
--
-- The user-facing spec for this template lives in
-- src/components/admin/WYWAEmailAdmin.jsx. Variables:
--   {{name}}       — substituted by admin-send-email from profile.full_name
--   {{days_away}}  — substituted from request.userVariables[userId] (new)
--   {{insight_1}}  — same path, line 1 of the WYWA delta block
--   {{insight_2}}  — same path, line 2
--   {{insight_3}}  — same path, line 3
--   {{app_url}}    — substituted by admin-send-email (constant 'pinex.in')
--
-- WHY ON CONFLICT: idempotent — re-running this migration overwrites
-- the row in place rather than erroring on the duplicate primary key.
-- Useful when iterating on subject / HTML during admin tweaks.

INSERT INTO email_templates (id, name, subject, html_body, updated_at)
VALUES (
  'while_you_were_away',
  'While You Were Away',
  'You missed {{days_away}} days of market movement',
  $$
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>While you were away</title>
</head>
<body style="margin:0;padding:24px;background:#0B0E11;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#E2E8F0;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"
         style="max-width:560px;margin:0 auto;background:#0F1217;border-left:3px solid #FBBF24;border-radius:6px;">
    <tr>
      <td style="padding:24px;">
        <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#FBBF24;font-weight:700;margin-bottom:12px;">
          While you were away &middot; {{days_away}} days
        </div>
        <h2 style="font-size:18px;font-weight:600;color:#E2E8F0;margin:0 0 14px;line-height:1.35;">
          Hi {{name}}, here&rsquo;s what changed.
        </h2>
        <p style="font-size:14px;color:#E2E8F0;line-height:1.7;margin:0 0 8px;">
          <span style="color:#FBBF24;">&rarr;</span> {{insight_1}}
        </p>
        <p style="font-size:14px;color:#E2E8F0;line-height:1.7;margin:0 0 8px;">
          <span style="color:#FBBF24;">&rarr;</span> {{insight_2}}
        </p>
        <p style="font-size:14px;color:#E2E8F0;line-height:1.7;margin:0 0 20px;">
          <span style="color:#FBBF24;">&rarr;</span> {{insight_3}}
        </p>
        <a href="{{app_url}}/explore"
           style="display:inline-block;padding:10px 18px;background:#FBBF24;color:#0B0E11;font-size:13px;font-weight:700;text-decoration:none;border-radius:4px;">
          See what changed &rarr;
        </a>
        <p style="font-size:11px;color:#64748B;margin:24px 0 0;line-height:1.55;">
          Data observation only. Not investment advice.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
  $$,
  now()
)
ON CONFLICT (id) DO UPDATE
SET
  name       = EXCLUDED.name,
  subject    = EXCLUDED.subject,
  html_body  = EXCLUDED.html_body,
  updated_at = now();
