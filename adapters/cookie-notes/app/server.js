// Cookie-Notes — a MINIMAL but real, HERMETIC notes app whose WHOLE POINT is an
// auth mechanism the other reference consumers lack: an httpOnly SERVER SESSION
// COOKIE (opaque `sid`, NOT readable by JS), backed by an in-memory session store.
//
// Contrast with the RealWorld consumer (a JWT in localStorage that Playwright's
// storageState carries natively): here the credential is a server-side session,
// reachable only via the cookie — so the harness must carry it as a cookie, and
// `assertAuthenticated` can only probe it at runtime (GET /api/me), never parse it.
//
// NO DB (in-memory users + notes + sessions), NO secrets. The session secret and
// the fixed throwaway user are non-sensitive local-dev constants — the app is
// hermetic and self-bootstrapping (register-if-needed on first login).
const express = require('express')
const session = require('express-session')

const PORT = Number(process.env.PORT ?? 3100)

// A fixed, throwaway local user — NOT a credential (the app is hermetic). The
// app self-creates it on first login (register-if-needed), so no seeding step.
const THROWAWAY_USER = { username: 'e2e-user', password: 'e2e-pass' }

// In-memory stores — every process start (every `docker compose up`) is pristine.
const users = new Map() // username -> { username, password }
const notes = [] // { id, title, body, owner }
let nextNoteId = 1

const app = express()
app.disable('x-powered-by')
app.use(express.json())
app.use(express.urlencoded({ extended: false }))

app.use(
  session({
    name: 'sid', // the opaque session-id cookie
    secret: 'cookie-notes-dev-secret-not-sensitive', // throwaway local-dev value
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true, // THE point: the session cookie is NOT readable by JS
      sameSite: 'lax',
      secure: false, // plain http for the hermetic local stack
    },
  }),
)

// --- tiny HTML helpers (server-rendered, role-friendly: real h1/a/button/form) --
function page(title, body) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${esc(title)}</title></head>
<body>
${body}
</body>
</html>`
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// --- auth helpers --------------------------------------------------------------
function currentUser(req) {
  return req.session && req.session.username ? req.session.username : null
}

// register-if-needed, then validate. Returns the username or null.
function authenticate(username, password) {
  if (!username || !password) return null
  let user = users.get(username)
  if (!user) {
    // Self-bootstrap: the fixed throwaway user is auto-created on first login.
    if (username === THROWAWAY_USER.username && password === THROWAWAY_USER.password) {
      user = { username, password }
      users.set(username, user)
    } else {
      return null
    }
  }
  return user.password === password ? user.username : null
}

// Page guard: redirect unauthenticated browsers to /login.
function requirePage(req, res, next) {
  if (!currentUser(req)) return res.redirect(302, '/login')
  next()
}

// API guard: 401 for unauthenticated JSON callers.
function requireApi(req, res, next) {
  if (!currentUser(req)) return res.status(401).json({ error: 'unauthorized' })
  next()
}

// --- health --------------------------------------------------------------------
app.get('/healthz', (_req, res) => res.status(200).type('text/plain').send('ok'))

// --- server-rendered HTML ------------------------------------------------------
app.get('/login', (req, res) => {
  if (currentUser(req)) return res.redirect(302, '/')
  res.type('html').send(
    page(
      'Sign in',
      `<h1>Sign in</h1>
<form method="post" action="/login">
  <p>
    <label for="username">Username</label>
    <input id="username" name="username" type="text" autocomplete="username" required>
  </p>
  <p>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
  </p>
  <button type="submit">Sign in</button>
</form>`,
    ),
  )
})

app.post('/login', (req, res) => {
  const username = authenticate(req.body.username, req.body.password)
  if (!username) {
    return res
      .status(401)
      .type('html')
      .send(
        page(
          'Sign in',
          `<h1>Sign in</h1>
<p>Invalid username or password.</p>
<p><a href="/login">Try again</a></p>`,
        ),
      )
  }
  req.session.username = username
  res.redirect(302, '/')
})

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('sid')
    res.redirect(302, '/login')
  })
})

app.get('/', requirePage, (req, res) => {
  const me = currentUser(req)
  const mine = notes.filter((n) => n.owner === me)
  const items =
    mine.length === 0
      ? '<p>No notes yet.</p>'
      : `<ul>${mine
          .map((n) => `<li><a href="/notes/${n.id}">${esc(n.title)}</a></li>`)
          .join('')}</ul>`
  res.type('html').send(
    page(
      'Notes',
      `<h1>Notes</h1>
<p>Signed in as ${esc(me)}.</p>
<p><a href="/notes/new">New note</a></p>
${items}
<form method="post" action="/logout"><button type="submit">Sign out</button></form>`,
    ),
  )
})

app.get('/notes/new', requirePage, (_req, res) => {
  res.type('html').send(
    page(
      'New note',
      `<h1>New note</h1>
<form method="post" action="/notes">
  <p>
    <label for="title">Title</label>
    <input id="title" name="title" type="text" required>
  </p>
  <p>
    <label for="body">Body</label>
    <textarea id="body" name="body"></textarea>
  </p>
  <button type="submit">Create</button>
</form>
<p><a href="/">Back</a></p>`,
    ),
  )
})

app.post('/notes', requirePage, (req, res) => {
  const note = {
    id: nextNoteId++,
    title: String(req.body.title ?? '').trim() || 'Untitled',
    body: String(req.body.body ?? ''),
    owner: currentUser(req),
  }
  notes.push(note)
  res.redirect(302, `/notes/${note.id}`)
})

app.get('/notes/:id', requirePage, (req, res) => {
  const id = Number(req.params.id)
  const note = notes.find((n) => n.id === id && n.owner === currentUser(req))
  if (!note) {
    return res
      .status(404)
      .type('html')
      .send(page('Not found', `<h1>Not found</h1><p><a href="/">Back</a></p>`))
  }
  res.type('html').send(
    page(
      note.title,
      `<h1>${esc(note.title)}</h1>
<p>${esc(note.body)}</p>
<p><a href="/">Back</a></p>`,
    ),
  )
})

// --- JSON API (cookie-authed) --------------------------------------------------
// Seed self-bootstrap: log in via JSON, which sets the httpOnly `sid` cookie.
app.post('/api/login', (req, res) => {
  const username = authenticate(req.body.username, req.body.password)
  if (!username) return res.status(401).json({ error: 'invalid credentials' })
  req.session.username = username
  res.status(200).json({ username })
})

// THE auth probe endpoint: 200 {username} if the cookie carries a live session,
// else 401. The harness's assertAuthenticated hits this — it can't read `sid`.
app.get('/api/me', (req, res) => {
  const me = currentUser(req)
  if (!me) return res.status(401).json({ error: 'unauthorized' })
  res.status(200).json({ username: me })
})

app.get('/api/notes', requireApi, (req, res) => {
  const me = currentUser(req)
  res.status(200).json(
    notes
      .filter((n) => n.owner === me)
      .map((n) => ({ id: n.id, title: n.title, body: n.body })),
  )
})

app.post('/api/notes', requireApi, (req, res) => {
  const note = {
    id: nextNoteId++,
    title: String(req.body.title ?? '').trim() || 'Untitled',
    body: String(req.body.body ?? ''),
    owner: currentUser(req),
  }
  notes.push(note)
  res.status(201).json({ id: note.id, title: note.title })
})

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`cookie-notes listening on :${PORT}`)
})
