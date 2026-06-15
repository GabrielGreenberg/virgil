// CHIP 8 live-sweep harness — inject via preview_eval after every reload.
// Acquires: window.__v = { main, dh, cc, sentinel } and helper fns.
// main = main TipTap editor (largest doc.childCount); dh = shared grab+lightning
// dispatcher {open, dispatch(action, ref)}; cc = cardCreation {createNote,
// createCitation, createArchiveSnippet, ...}. See MEMO_ACTION_ALIGNMENT.md
// "Verification discipline" for provenance.
(() => {
  function fiberOf(el){ if(!el||!el.nodeType) return null; const k = Object.keys(el).find(k=>k.startsWith('__reactFiber$')||k.startsWith('__reactInternalInstance$')); return k?el[k]:null; }
  function nearestFiber(el){ let n=el,g=0; while(n&&g<6){const f=fiberOf(n); if(f) return f; n=n.parentElement; g++;} return null; }
  // editors via ProseMirror DOM -> nearest React fiber -> .editor on stateNode/props
  const editors = new Map();
  for (const el of document.querySelectorAll('.ProseMirror')) {
    let f = nearestFiber(el), hops=0;
    while (f && hops<40){
      for (const c of [f.stateNode,f.memoizedProps,f.memoizedState]){
        if(c&&typeof c==='object'&&!(c instanceof Node)){
          const ed=c.editor||((c.state&&c.view&&c.state.doc)?c:null);
          if(ed&&ed.state&&ed.state.doc&&ed.view&&ed.view.dom){ try{editors.set(ed,ed.state.doc.childCount);}catch(e){} }
        }
      }
      f=f.return; hops++;
    }
  }
  const elist=[...editors.entries()].sort((a,b)=>b[1]-a[1]);
  const main = elist[0]?elist[0][0]:null;
  // contexts: dispatcher {open,dispatch} + cardCreation {createCitation,...} via full fiber DFS
  let dh=null, cc=null;
  if (main) {
    let root = nearestFiber(main.view.dom); while(root&&root.return) root=root.return;
    const seen=new Set(); const stack=[root]; let n;
    while((n=stack.pop())){ if(!n||seen.has(n)) continue; seen.add(n);
      const v = n.memoizedProps && n.memoizedProps.value;
      if (v && typeof v==='object'){ try{ if(!dh && typeof v.dispatch==='function' && ('open' in v)) dh=v; if(!cc && (typeof v.createCitation==='function'||typeof v.createArchiveSnippet==='function')) cc=v; }catch(e){} }
      if(n.child) stack.push(n.child); if(n.sibling) stack.push(n.sibling);
    }
  }
  window.__v = { main, dh, cc };
  // helpers
  window.__v.uuids = () => { const o=[]; main.state.doc.forEach((nn,off,i)=>o.push({i,type:nn.type.name,uuid:nn.attrs&&nn.attrs.uuid})); return o; };
  window.__v.posOf = (uuid) => { let p=null; main.state.doc.forEach((nn,off)=>{ if(nn.attrs&&nn.attrs.uuid===uuid) p={pos:off,node:nn}; }); return p; };
  window.__v.tag = () => { window.__v.sentinel='S'+main.state.doc.childCount+'_'+Math.floor(performance.now()); main.__sweepTag=window.__v.sentinel; return window.__v.sentinel; };
  window.__v.checkRemount = () => {
    // re-find live main, compare to stashed
    const eds=new Map();
    for (const el of document.querySelectorAll('.ProseMirror')) { let f=nearestFiber(el),h=0; while(f&&h<40){ for(const c of [f.stateNode,f.memoizedProps,f.memoizedState]){ if(c&&typeof c==='object'&&!(c instanceof Node)){ const ed=c.editor||((c.state&&c.view&&c.state.doc)?c:null); if(ed&&ed.state&&ed.state.doc&&ed.view){ try{eds.set(ed,ed.state.doc.childCount);}catch(e){} } } } f=f.return; h++; } }
    const li=[...eds.entries()].sort((a,b)=>b[1]-a[1]); const live=li[0]?li[0][0]:null;
    return { remounted: live!==window.__v.main || (live&&live.__sweepTag!==window.__v.sentinel), liveChildCount: live?live.state.doc.childCount:null };
  };
  return { mainChildCount: main?main.state.doc.childCount:null, dh:!!dh, cc:!!cc, editors: elist.length };
})()
