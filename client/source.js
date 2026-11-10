/* Built with dictionaries and the matching Remote descriptor by build-client.mjs. */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-dreaming',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useRef, useCallback } = React;
    const dictionaries = /*__LOCALES__*/ {};
    const contribution = /*__PROTOCOL__*/ {};
    const NS = 'dreaming.memory';
    const PANEL = 'dreaming-memory';
    const categories = ['procedure', 'decision', 'preference', 'fact', 'pitfall'];
    const levels = [1, 2, 3, 4, 5];
    const statuses = ['supported', 'uncertain', 'stale'];
    const css = `
.dreaming-page{height:100%;width:100%;min-width:0;min-height:0;overflow:auto;box-sizing:border-box;padding:28px 32px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-size:14px;line-height:1.55;}
[data-platform="darwin"] .dreaming-page{padding-top:calc(28px + var(--dsh-frame-top-clearance,0px));}
.dreaming-page *{box-sizing:border-box}.dreaming-page h1,.dreaming-page h2,.dreaming-page h3,.dreaming-page p{margin:0}
.dreaming-page h1{font-size:25px;letter-spacing:-.6px;font-weight:650}.dreaming-page h2{font-size:19px;line-height:1.4}.dreaming-page h3{font-size:14px;font-weight:600}
.dreaming-top,.dreaming-actions,.dreaming-row,.dreaming-tags,.dreaming-tabs{display:flex;align-items:center;gap:10px}.dreaming-top{justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:18px;margin-bottom:22px}
.dreaming-muted{color:var(--dsw-alias-label-secondary)}.dreaming-small{font-size:12px}.dreaming-subtitle{margin-top:6px!important;max-width:630px}
.dreaming-page button,.dreaming-page input,.dreaming-page select{font:inherit;color:inherit;line-height:1.4}.dreaming-page button{cursor:pointer}.dreaming-page button:disabled{cursor:default;opacity:.5}
.dreaming-page button:focus-visible,.dreaming-page input:focus-visible,.dreaming-page select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px}
.dreaming-button{border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-base);padding:8px 13px;white-space:nowrap;min-height:36px}
.dreaming-button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1)}.dreaming-button.primary{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground);border-color:transparent}.dreaming-button.danger{color:var(--dsw-alias-state-error-primary)}
.dreaming-field{display:grid;gap:6px}.dreaming-select,.dreaming-search{border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-base);padding:9px 12px;min-width:0;min-height:39px}.dreaming-project{width:min(100%,660px);margin-bottom:20px}
.dreaming-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:0 0 22px}.dreaming-stat{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:14px 17px;background:var(--dsw-alias-bg-layer-1)}.dreaming-stat strong{display:block;font-size:26px;line-height:1.3;font-weight:600;margin:3px 0}.dreaming-stat span{font-size:12px;color:var(--dsw-alias-label-secondary)}
.dreaming-tabs{gap:20px;border-bottom:1px solid var(--dsw-alias-border-l1);margin-bottom:18px}.dreaming-tab{border:0;background:transparent;padding:9px 0 12px;color:var(--dsw-alias-label-secondary)!important;border-bottom:2px solid transparent}.dreaming-tab[aria-pressed="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)!important;font-weight:600}
.dreaming-workspace{display:grid;grid-template-columns:minmax(270px,.85fr) minmax(300px,1.25fr);gap:20px;align-items:start}.dreaming-filters{display:grid;gap:9px;margin-bottom:12px}.dreaming-filters .dreaming-row>*{width:50%}.dreaming-list{display:grid;gap:8px;max-height:65vh;overflow:auto;padding:3px}
.dreaming-card{text-align:left;display:grid;gap:8px;width:100%;padding:15px;border:1px solid var(--dsw-alias-border-l1);border-radius:11px;background:var(--dsw-alias-bg-base)}.dreaming-card:hover{background:var(--dsw-alias-bg-layer-1)}.dreaming-card[aria-pressed="true"]{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-1)}.dreaming-card-title{font-weight:600;overflow-wrap:anywhere}.dreaming-preview{font-size:12px;color:var(--dsw-alias-label-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.dreaming-tags{gap:6px;flex-wrap:wrap}.dreaming-badge{font-size:11px;font-weight:500;border-radius:5px;padding:2px 7px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}.dreaming-badge.supported{color:var(--dsw-alias-state-success-primary)}.dreaming-badge.uncertain{color:var(--dsw-alias-state-warn-primary)}.dreaming-badge.stale{text-decoration:line-through}
.dreaming-detail{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:22px;min-height:350px;overflow-wrap:anywhere}.dreaming-detail h2{margin:12px 0}.dreaming-content{white-space:pre-wrap;line-height:1.8;margin:18px 0!important}.dreaming-divider{border:0;border-top:1px solid var(--dsw-alias-border-l1);margin:22px 0}.dreaming-source{margin-top:12px;padding:12px 14px;background:var(--dsw-alias-bg-layer-1);border-radius:8px;border-left:3px solid var(--dsw-alias-border-l2)}.dreaming-source blockquote{margin:8px 0;white-space:pre-wrap}.dreaming-source code{font-size:11px;overflow-wrap:anywhere}.dreaming-detail-footer{display:flex;justify-content:space-between;gap:15px;align-items:center;flex-wrap:wrap;margin-top:22px}
.dreaming-access{display:flex;align-items:center;justify-content:space-between;gap:16px;user-select:none;margin:18px 0;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px}.dreaming-access strong,.dreaming-access small{display:block}.dreaming-access small{color:var(--dsw-alias-label-secondary);font-size:12px;margin-top:3px}
.dreaming-switch{appearance:none;flex:none;width:36px;height:22px;border:1px solid var(--dsw-alias-label-secondary);border-radius:14px;background:var(--dsw-alias-bg-layer-2);margin:0;cursor:pointer}.dreaming-switch:before{content:"";display:block;width:14px;height:14px;margin:3px;border-radius:50%;background:var(--dsw-alias-label-secondary)}.dreaming-switch:checked{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}.dreaming-switch:checked:before{transform:translateX(14px);background:var(--dsw-alias-bg-base)}.dreaming-switch:disabled{opacity:.55;cursor:default}
@media(forced-colors:active){.dreaming-switch{appearance:auto}.dreaming-switch:before{display:none}}
.dreaming-list-meta{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin:12px 0}.dreaming-list-meta label{display:inline-flex;align-items:center;gap:6px}
.dreaming-empty{padding:42px 22px;text-align:center;border:1px dashed var(--dsw-alias-border-l2);border-radius:12px;color:var(--dsw-alias-label-secondary)}.dreaming-empty strong{display:block;color:var(--dsw-alias-label-primary);margin-bottom:8px}.dreaming-empty svg{margin-bottom:12px}.dreaming-message{padding:12px 15px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);margin-bottom:14px;overflow-wrap:anywhere}.dreaming-error{color:var(--dsw-alias-state-error-primary)}.dreaming-confirm{margin-top:15px;padding:15px;border:1px solid var(--dsw-alias-state-warn-primary);border-radius:10px}.dreaming-confirm .dreaming-actions{margin-top:12px}.dreaming-history{display:grid;gap:10px}.dreaming-history-row{display:flex;align-items:center;gap:18px;justify-content:space-between;padding:16px 20px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px}.dreaming-history-row strong{font-size:16px}.dreaming-history-row .dreaming-muted{margin-top:3px}.dreaming-caption{margin:14px 0!important}.dreaming-spin{display:inline-block;animation:dreaming-pulse 1.4s ease-in-out infinite}@keyframes dreaming-pulse{50%{opacity:.4}}@media(prefers-reduced-motion:reduce){.dreaming-spin{animation:none}}@media(max-width:900px){.dreaming-page{padding:22px 20px}.dreaming-workspace{grid-template-columns:1fr}.dreaming-list{max-height:380px}.dreaming-stats{gap:8px}.dreaming-stat{padding:12px}.dreaming-top .dreaming-actions{flex-wrap:wrap}}@media(max-width:480px){.dreaming-stats{grid-template-columns:repeat(2,1fr)}.dreaming-page{padding:18px 12px}.dreaming-history-row{align-items:flex-start;flex-wrap:wrap}}
`;
    function Icon({ size = 20 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M9 4a3 3 0 0 0-5 2.2 3.8 3.8 0 0 0-1 6.9A4 4 0 0 0 7 19a3 3 0 0 0 5 1 3 3 0 0 0 5-1 4 4 0 0 0 4-5.9 3.8 3.8 0 0 0-1-6.9A3 3 0 0 0 15 4' }),
        h('path', { d: 'M12 4v16M8 8c-2 0-3 2-2 4m12 0c1-2 0-4-2-4M7 15c2 0 3 1 3 3m7-3c-2 0-3 1-3 3' }));
    }
    function Page({ t, api }) {
      const [projects, setProjects] = useState(null);
      const [project, setProject] = useState('');
      const [snapshot, setSnapshot] = useState(null);
      const [selected, setSelected] = useState('');
      const [query, setQuery] = useState('');
      const [pausedOnly, setPausedOnly] = useState(false);
      const [levelFilter, setLevelFilter] = useState(0);
      const [category, setCategory] = useState('all');
      const [status, setStatus] = useState('active');
      const [tab, setTab] = useState('memories');
      const [loading, setLoading] = useState(false);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');
      const [notice, setNotice] = useState(null);
      const [confirmation, setConfirmation] = useState(null);
      const alive = useRef(true);
      const version = useRef(0);
      const translate = useRef(t);
      translate.current = t;
      const currentProject = useRef(project);
      currentProject.current = project;
      const friendlyError = useCallback(e => {
        const code = e?.code || '';
        const message = e?.message || String(e);
        return `${translate.current('requestError')}${code ? ` (${code})` : ''}: ${message}`;
      }, []);
      const call = useCallback(async (method, request) => {
        const result = request === undefined ? await api[method]() : await api[method](request);
        if (!result.ok) throw result.error;
        return result.value;
      }, [api]);
      const load = useCallback(async (root, clearError = true) => {
        if (!root) return;
        const requestVersion = ++version.current;
        setLoading(true);
        if (clearError) setError('');
        try {
          const value = await call('snapshot', { projectRoot: root });
          if (!alive.current || requestVersion !== version.current) return;
          setSnapshot(value);
          setConfirmation(null);
          setSelected(old => value.memories.some(f => f.id === old) ? old : value.memories.find(f => f.status !== 'stale')?.id || value.memories[0]?.id || '');
        } catch (e) {
          if (alive.current && requestVersion === version.current) setError(friendlyError(e));
        } finally {
          if (alive.current && requestVersion === version.current) setLoading(false);
        }
      }, [call, friendlyError]);
      const loadProjects = useCallback(async () => {
        setError('');
        try {
          const roots = await call('projects');
          if (!alive.current) return;
          setProjects(roots);
          setProject(old => roots.includes(old) ? old : roots[0] || '');
        } catch (e) { if (alive.current) setError(friendlyError(e)); }
      }, [call, friendlyError]);
      useEffect(() => {
        alive.current = true;
        void loadProjects();
        return () => { alive.current = false; ++version.current; };
      }, [loadProjects]);
      useEffect(() => {
        ++version.current;
        setSnapshot(null);
        setSelected('');
        setConfirmation(null);
        setNotice(null);
        setQuery('');
        setLevelFilter(0);
        setPausedOnly(false);
        void load(project);
      }, [project, load]);
      useEffect(() => {
        if (!snapshot?.running || busy) return;
        const timer = setTimeout(() => void load(project, false), 2000);
        return () => clearTimeout(timer);
      }, [snapshot, busy, project, load]);
      async function act(method, extra = {}) {
        if (busy || !project) return;
        const root = project;
        setBusy(true);
        setError('');
        setNotice(null);
        setConfirmation(null);
        try {
          const value = await call(method, { projectRoot: root, ...extra });
          if (!alive.current || currentProject.current !== root) return;
          setNotice({ method, value });
        } catch (e) {
          if (alive.current && currentProject.current === root) setError(friendlyError(e));
        } finally {
          if (alive.current && currentProject.current === root) {
            // Read even after failure: a disconnected response can hide a committed revision.
            setBusy(false);
            await load(root, false);
          }
        }
      }
      const formatDate = value => value ? new Date(value).toLocaleString() : t('never');
      const button = (text, onClick, options = {}) => h('button', { type: 'button', className: 'dreaming-button', onClick, ...options }, text);
      const badge = (kind, value) => h('span', { className: `dreaming-badge ${kind === 'status' ? value : ''}` }, t(`${kind}.${value}`));
      const empty = (title, body) => h('div', { className: 'dreaming-empty' }, h(Icon, { size: 34 }), h('strong', null, title), h('p', null, body));
      const all = snapshot?.memories || [];
      const hidden = new Set(snapshot?.hiddenMemoryIds);
      const filtered = all.filter(f => (!pausedOnly || hidden.has(f.id)) && (!levelFilter || f.level === levelFilter) && (category === 'all' || f.category === category) && (status === 'all' || status === 'active' ? status === 'all' || f.status !== 'stale' : f.status === status) && (!query.trim() || `${f.title}\n${f.content}\n${f.sources.map(s => s.quote).join('\n')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))).sort((a,b) => a.level - b.level || b.updatedAt.localeCompare(a.updatedAt));
      const fact = filtered.find(f => f.id === selected) || filtered[0];
      const locked = busy || loading || snapshot?.running || Boolean(error);
      const renderConfirm = () => confirmation && h('div', { className: 'dreaming-confirm', role: 'alert' },
        h('strong', null, confirmation.method === 'setLevel' ? t('shareTitle') : confirmation.method === 'forget' ? t('confirmForgetTitle') : `${t('confirmRollbackTitle')} #${confirmation.args.revision}`),
        h('p', { className: 'dreaming-small dreaming-muted' }, t(confirmation.method === 'setLevel' ? 'shareBody' : confirmation.method === 'forget' ? 'confirmForgetBody' : 'confirmRollbackBody')),
        h('div', { className: 'dreaming-actions' }, button(t('cancel'), () => setConfirmation(null)), button(t('confirm'), () => void act(confirmation.method, confirmation.args), { className: 'dreaming-button danger', disabled: locked })));
      return h('section', { className: 'dreaming-page', 'aria-label': t('panel') },
        h('style', null, css),
        h('div', { className: 'dreaming-top' },
          h('div', null, h('h1', null, t('panel')), h('p', { className: 'dreaming-muted dreaming-subtitle' }, t('subtitle'))),
          h('div', { className: 'dreaming-actions' }, button(loading ? t('loading') : t('refresh'), () => void (project ? load(project) : loadProjects()), { disabled: busy || loading }), button(busy || snapshot?.running ? t('running') : t('dream'), () => void act('run'), { className: 'dreaming-button primary', disabled: !project || !snapshot || locked }))),
        error && h('div', { role: 'alert', className: 'dreaming-message dreaming-error' }, error),
        notice && h('div', { role: 'status', className: 'dreaming-message' }, notice.method === 'run'
          ? `${t('dreamDone')} ${t('created')}: ${notice.value.created} · ${t('updated')}: ${notice.value.updated} · ${t('retired')}: ${notice.value.retired}${notice.value.unchanged ? ` · ${t('unchanged')}` : ''}`
          : `${t(notice.method === 'setVisibility' ? 'visibilitySaved' : notice.method === 'setLevel' ? 'levelChanged' : notice.method === 'forget' ? 'forgotten' : 'rolledBack')} #${notice.value.revision}`),
        projects === null && !error && h('p', { role: 'status', className: 'dreaming-muted' }, t('loading')),
        projects?.length === 0 && empty(t('noProjects'), t('configureProjects')),
        projects?.length > 0 && h('label', { className: 'dreaming-field dreaming-project' }, h('span', { className: 'dreaming-small dreaming-muted' }, t('project')), h('select', { className: 'dreaming-select', value: project, title: project, disabled: busy, onChange: e => setProject(e.target.value) }, projects.map(root => h('option', { key: root, value: root }, `${root.split(/[\\/]/).filter(Boolean).pop()} — ${root}`)))),
        snapshot && h(React.Fragment, null,
          h('div', { className: 'dreaming-stats' },
            ...[['activeCount', all.filter(f => f.status !== 'stale').length], ['supportedCount', all.filter(f => f.status === 'supported').length], ['uncertainCount', all.filter(f => f.status === 'uncertain').length], ['revision', `#${snapshot.revision}`]].map(([label, count]) => h('div', { className: 'dreaming-stat', key: label }, h('span', null, t(label)), h('strong', null, count)))),
          h('div', { className: 'dreaming-tabs', 'aria-label': t('views') }, ...['memories', 'history'].map(value => h('button', { type: 'button', key: value, className: 'dreaming-tab', 'aria-pressed': tab === value, onClick: () => { setTab(value); setConfirmation(null); } }, t(value)))),
          tab === 'memories' ? h('div', { className: 'dreaming-workspace' },
            h('div', null,
              h('div', { className: 'dreaming-filters' },
                h('input', { type: 'search', className: 'dreaming-search', value: query, onChange: e => setQuery(e.target.value), placeholder: t('search'), 'aria-label': t('search') }),
                h('select', { className: 'dreaming-select', value: levelFilter, 'aria-label': t('levelFilter'), onChange: e => setLevelFilter(Number(e.target.value)) }, h('option', { value: 0 }, t('allLevels')), ...levels.map(l => h('option', { key: l, value: l }, t(`level.${l}`)))),
                h('div', { className: 'dreaming-row' },
                  h('select', { className: 'dreaming-select', value: category, 'aria-label': t('categoryFilter'), onChange: e => setCategory(e.target.value) }, h('option', { value: 'all' }, t('allCategories')), ...categories.map(c => h('option', { key: c, value: c }, t(`category.${c}`)))),
                  h('select', { className: 'dreaming-select', value: status, 'aria-label': t('statusFilter'), onChange: e => setStatus(e.target.value) }, ...['active','all',...statuses].map(s => h('option', { key: s, value: s }, t(`status.${s}`)))))),
              h('div', { className: 'dreaming-list-meta dreaming-small' },
                h('label', null, h('input', { type: 'checkbox', checked: pausedOnly, onChange: e => setPausedOnly(e.target.checked) }), t('pausedOnly')),
                h('span', { className: 'dreaming-muted', 'aria-live': 'polite' }, `${filtered.length} ${t('results')}`)),
              filtered.length ? h('div', { className: 'dreaming-list', 'aria-label': t('memories') }, ...filtered.map(f => h('button', { type: 'button', key: f.id, className: 'dreaming-card', 'aria-pressed': f.id === fact?.id, onClick: () => { setSelected(f.id); setConfirmation(null); } }, h('div', { className: 'dreaming-tags' }, badge('level', f.level), badge('category', f.category), badge('status', f.status), hidden.has(f.id) && h('span', { className: 'dreaming-badge' }, t('paused'))), h('span', { className: 'dreaming-card-title' }, f.title), h('span', { className: 'dreaming-preview' }, f.content), h('span', { className: 'dreaming-small dreaming-muted' }, `${f.sources.length} ${t('sources')} · ${formatDate(f.updatedAt)}`))))
                : empty(t(all.length ? 'noMatches' : 'noMemories'), t(all.length ? 'adjustFilters' : 'firstDream'))),
            fact ? h('article', { className: 'dreaming-detail', 'aria-label': t('detail') },
              h('div', { className: 'dreaming-tags' }, badge('level', fact.level), badge('category', fact.category), badge('status', fact.status)),
              h('h2', null, fact.title), h('p', { className: 'dreaming-small dreaming-muted' }, `${t('updatedAt')} ${formatDate(fact.updatedAt)}`),
              h('p', { className: 'dreaming-content' }, fact.content),
              h('label', { className: 'dreaming-access' },
                h('span', null, h('strong', null, t('agentAccess')), h('small', { id: 'dreaming-access-hint' }, t(fact.level === 1 && !fact.inherited ? 'accessGlobalHint' : 'accessProjectHint'))),
                h('input', { type: 'checkbox', role: 'switch', className: 'dreaming-switch', 'aria-label': t('agentAccess'), 'aria-describedby': 'dreaming-access-hint',
                  checked: !hidden.has(fact.id), disabled: locked, onChange: e => void act('setVisibility', { id: fact.id, visible: e.target.checked, expectedRevision: snapshot.revision }) })),
              fact.inherited ? h('p', { className: 'dreaming-small dreaming-muted' }, t('inherited')) : fact.status !== 'stale' && h('label', { className: 'dreaming-field' }, t('levelFilter'),
                h('select', { className: 'dreaming-select', value: fact.level, disabled: locked, onChange: e => {
                  const level = Number(e.target.value);
                  if (level === 1) setConfirmation({ method: 'setLevel', args: { id: fact.id, level: 1, expectedRevision: snapshot.revision } });
                  else void act('setLevel', { id: fact.id, level, expectedRevision: snapshot.revision });
                } }, levels.map(l => h('option', { key: l, value: l, disabled: l === 1 && fact.status !== 'supported' }, t(`level.${l}`))))),
              confirmation?.method === 'setLevel' && confirmation.args.id === fact.id && renderConfirm(),
              fact.retiredReason && h('div', { className: 'dreaming-message' }, `${t('retiredReason')}: ${fact.retiredReason}`),
              h('hr', { className: 'dreaming-divider' }), h('h3', null, `${t('evidence')} · ${fact.sources.length}`),
              !fact.inherited && h('p', { className: 'dreaming-small dreaming-muted' }, t('evidenceHint')),
              ...fact.sources.map((source, index) => h('div', { className: 'dreaming-source', key: `${source.sessionId}:${source.seq}:${index}` },
                h('div', { className: 'dreaming-tags' }, h('span', { className: 'dreaming-badge' }, t(`source.${source.kind}`)), h('span', { className: 'dreaming-small dreaming-muted' }, formatDate(source.observedAt))),
                h('blockquote', null, source.quote), h('code', null, `${source.sessionId} · #${source.seq}`))),
              h('div', { className: 'dreaming-detail-footer' }, h('span', { className: 'dreaming-small dreaming-muted' }, `${t('createdAt')} ${formatDate(fact.createdAt)}`), !fact.inherited && button(t('forget'), () => setConfirmation({ method: 'forget', args: { id: fact.id } }), { className: 'dreaming-button danger', disabled: locked })), confirmation?.method === 'forget' && confirmation.args.id === fact.id && renderConfirm())
              : empty(t('selectMemory'), t('selectMemoryBody')))
            : h('div', null, h('p', { className: 'dreaming-muted dreaming-caption' }, t('historyHint')), confirmation?.method === 'rollback' && renderConfirm(),
              !snapshot.revisions.length && empty(t('noHistory'), t('firstDream')), h('div', { className: 'dreaming-history' }, ...[...snapshot.revisions].sort((a,b) => b.revision - a.revision).map(rev => h('div', { key: rev.revision, className: 'dreaming-history-row' }, h('div', null, h('strong', null, `${t('revision')} #${rev.revision}`), rev.revision === snapshot.revision && h('span', { className: 'dreaming-badge', style: { marginLeft: 8 } }, t('current')), h('p', { className: 'dreaming-small dreaming-muted' }, `${formatDate(rev.createdAt)} · ${rev.facts} ${t('results')}`)), button(t('rollback'), () => setConfirmation({ method: 'rollback', args: { revision: rev.revision } }), { disabled: locked || rev.revision === snapshot.revision }))))),
          h('p', { className: 'dreaming-small dreaming-muted dreaming-caption' }, `${t('automation')}: ${snapshot.autoRunAfterTurn ? t('afterTurn') : snapshot.autoRunIntervalMinutes ? t('periodic') : t('manual')}${snapshot.autoRunIntervalMinutes ? ` · ${snapshot.autoRunIntervalMinutes} ${t('minutes')}` : ''} · ${t('lastOperation')}: ${formatDate(snapshot.lastRun?.at)}`),
          snapshot.lastRun?.error && h('p', { className: 'dreaming-small dreaming-error' }, snapshot.lastRun.error)));
    }
    return {
      inject: ['slots', 'locale', 'remote'],
      async apply(ctx) {
        try {
        ctx.effect(() => ctx.locale.register(NS, dictionaries), 'dreaming: dictionaries');
        const unmount = await ctx.remote.$mount(contribution);
        ctx.effect(() => unmount, 'dreaming: remote namespace');
        const t = ctx.locale.bind(NS);
        ctx.inject(['remote.dreamingUi'], child => {
          const api = child.remote.dreamingUi;
          child.slots.inject('main', () => child.slots.register({ name: 'main', key: PANEL, locale: NS, inject: () => ({ api }) }, Page));
          child.slots.inject('sidebar.panellist', () => child.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 20, locale: NS, label: () => t('panel') }, Icon));
        });
        } catch (error) { console.error('[dreaming] Cannot initialize memory panel', error); throw error; }
      },
    };
  },
});
