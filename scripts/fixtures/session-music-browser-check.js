(async () => {
  const checks = [];
  const assert = (ok, label) => { if (!ok) throw Error(label); checks.push(label); };
  const badge = () => document.querySelector('[role="img"][aria-label="Music playing in this session"]');
  const card = () => [...document.querySelectorAll('h3')].find(h => h.textContent.includes('Ladder'));
  const toggle = () => [...document.querySelectorAll('button')].find(b => /shared music/.test(b.textContent));
  assert(!!card(), 'actual SessionCard renders with a meaningful title');
  assert(!badge(), 'inactive shared music has no badge');
  toggle().click();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert(!!badge(), 'shared music makes the badge appear on the card');
  assert(card().parentElement.contains(badge()), 'badge sits next to the session title');
  assert(badge().querySelectorAll('.ms-session-music-bar').length === 3, 'three equalizer bars render');
  assert(getComputedStyle(badge().querySelector('.ms-session-music-bar')).animationName === 'sessionMusicEqualizer',
    'equalizer animates when motion is allowed');
  assert(badge().getAttribute('title') === 'Music playing in this session', 'icon has a readable tooltip');
  toggle().click();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert(!badge(), 'pausing removes the badge without leaving a stale indicator');
  assert(window.__consoleErrors.length === 0, 'card has no uncaught browser errors');
  window.__musicCardResults = checks;
  return checks;
})()
