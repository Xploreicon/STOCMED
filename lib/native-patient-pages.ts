const LOCATIONS = ['Lagos', 'Abuja', 'Port Harcourt', 'Ibadan', 'Other'] as const

export function isPatientLocation(value: string): boolean {
  return (LOCATIONS as readonly string[]).includes(value)
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function pageShell(title: string, content: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(title)} · StocMed</title>
  <style>
    :root{color-scheme:light;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17243a;background:#fff}
    *{box-sizing:border-box}body{margin:0;background:#fff;color:#17243a}header{border-bottom:1px solid #dfe5ec;padding:16px 24px}nav{max-width:1200px;margin:auto;display:flex;align-items:center;justify-content:space-between;gap:20px}main{max-width:520px;margin:auto;padding:54px 24px 96px}a{color:#087a70;text-decoration:none;font-weight:600}.brand{color:#17243a;font-size:18px}.muted{color:#5f6b7a;font-size:14px}h1{font-family:Georgia,serif;font-size:32px;font-weight:500;line-height:1.15;margin:0 0 8px}p{color:#5f6b7a;line-height:1.6;margin:0 0 28px}form{display:grid;gap:20px;margin-top:28px}label{display:grid;gap:8px;font-size:14px;font-weight:600}input,select,button{width:100%;min-height:48px;border-radius:8px;font:inherit}input,select{border:1px solid #cfd8e3;background:#fff;color:#17243a;padding:0 14px}input:focus,select:focus{border-color:#087a70;outline:3px solid rgba(8,122,112,.14)}button{border:0;background:#087a70;color:#fff;font-size:16px;font-weight:700;padding:0 18px}.terms{display:flex;align-items:flex-start;gap:10px;color:#5f6b7a;font-weight:400;line-height:1.5}.terms input{width:18px;min-height:18px;margin-top:2px}.hint{font-size:13px;font-weight:400;color:#798493}.alert{border:1px solid #f0b7b7;background:#fff5f5;color:#a12626;border-radius:8px;padding:12px 14px;font-size:14px;font-weight:600;line-height:1.5}.mark{width:48px;height:48px;border-radius:50%;display:grid;place-items:center;background:#e7f4f2;color:#087a70;font-size:22px;margin-bottom:20px}@media(max-width:520px){header{padding:14px 18px}nav .muted{font-size:13px}main{padding:42px 20px 72px}h1{font-size:29px}}
  </style>
</head>
<body>${content}</body>
</html>`
}

function locationOptions(selected: string): string {
  return [
    '<option value="" disabled' + (selected ? '' : ' selected') + '>Select location</option>',
    ...LOCATIONS.map(location => (
      `<option value="${location}"${selected === location ? ' selected' : ''}>${location}</option>`
    )),
  ].join('')
}

export function renderNativeSignup(options: {
  error?: string
  fullName?: string
  email?: string
  phone?: string
  location?: string
} = {}): string {
  const error = options.error
    ? `<div class="alert" role="alert">${escapeHtml(options.error)}</div>`
    : ''
  const content = `
<header><nav><a class="brand" href="/">StocMed</a><span class="muted">Already have an account? <a href="/login">Log in</a></span></nav></header>
<main>
  <div class="mark" aria-hidden="true">P</div>
  <h1>Create your patient account</h1>
  <p>Find medication and reserve it at nearby pharmacies.</p>
  <form action="/signup" method="post">
    ${error}
    <label>Full name<input name="full_name" autocomplete="name" value="${escapeHtml(options.fullName || '')}" required></label>
    <label>Email address<input name="email" type="email" autocomplete="email" value="${escapeHtml(options.email || '')}" required></label>
    <label>Phone number<input name="phone" inputmode="tel" autocomplete="tel" placeholder="+234XXXXXXXXXX" value="${escapeHtml(options.phone || '')}" required></label>
    <label>Location<select name="location" required>${locationOptions(options.location || '')}</select><span class="hint">Used to show pharmacies nearest to you</span></label>
    <label>Password<input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
    <label>Confirm password<input name="confirm_password" type="password" autocomplete="new-password" minlength="8" required></label>
    <label class="terms"><input name="accepted_terms" type="checkbox" required><span>I agree to StocMed's <a href="/terms" target="_blank" rel="noreferrer">Terms of Service</a> and <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.</span></label>
    <button type="submit">Create account</button>
  </form>
</main>`
  return pageShell('Create your patient account', content)
}

export function renderNativeCompleteProfile(options: {
  fullName?: string
  error?: string
} = {}): string {
  const error = options.error
    ? `<div class="alert" role="alert">${escapeHtml(options.error)}</div>`
    : ''
  const content = `
<header><nav><a class="brand" href="/">StocMed</a></nav></header>
<main>
  <div class="mark" aria-hidden="true">P</div>
  <h1>Finish your patient profile</h1>
  <p>Add the details StocMed needs to personalize medication search and nearby results.</p>
  <form action="/complete-profile" method="post">
    ${error}
    <label>Full name<input name="full_name" autocomplete="name" value="${escapeHtml(options.fullName || '')}" required></label>
    <label>Mobile number<input name="phone" inputmode="tel" autocomplete="tel" placeholder="+2348031234567" required></label>
    <label>Location<select name="location" required>${locationOptions('')}</select></label>
    <label class="terms"><input name="accepted_terms" type="checkbox" required><span>I agree to the StocMed terms and privacy notice.</span></label>
    <button type="submit">Continue as patient</button>
  </form>
</main>`
  return pageShell('Finish your patient profile', content)
}
