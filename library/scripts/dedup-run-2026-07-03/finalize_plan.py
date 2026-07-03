#!/usr/bin/env python3
"""Fold LLM adjudication verdicts into the scan plan → final_plan.json.

Correct, overlap-safe approach: treat every adjudicated "same" decision as a
set of citekeys that must merge, union-find them into DISJOINT groups, then
re-plan each group with the shipped pick_survivor/_member_actions logic. This
guarantees no citekey is both a survivor and a loser (the bug of appending
promoted pairs as independent clusters).

Verdict application:
  AUTO cluster (high-confidence rule):
      same / absent -> merge all members
      mixed         -> merge members minus distinct_members
      distinct/unsure -> DROP (do not merge)
  CONFLICT cluster (>=2 load-bearing; needs positive confirmation):
      same  -> merge all
      mixed -> merge minus distinct_members
      distinct/unsure/absent -> DROP
  UNCERTAIN pair:
      same -> merge {a, b}   ;  else drop
"""
import json, sys
from pathlib import Path
from collections import Counter

SCR = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".")
LIB = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("/Users/gabriel/Library/CloudStorage/Dropbox/Virgil-Library")
SCRIPTS = "/Users/gabriel/Programming/virgil-dedup-wt/library/scripts"
sys.path.insert(0, SCRIPTS)

import work_identity as wi
import dedup_index as di
import dedup as dd
from _tools import read_master_bib

plan = json.load(open(SCR / "plan.json"))
adj_dir = SCR / "adj_out"

conflict_v, uncertain_v, auto_v = {}, {}, {}
for f in sorted(adj_dir.glob("*.out.json")):
    name = f.name
    data = json.load(open(f))
    if name.startswith("conflict"):
        tgt = conflict_v
    elif name.startswith("uncertain"):
        tgt = uncertain_v
    else:  # auto_ or autoall_
        tgt = auto_v
    for v in data.get("verdicts", []):
        tgt[v.get("id")] = v

# Adversarial verification of folder-archiving clusters (keyed by work_key).
verify_v = {}
verify_dir = SCR / "verify_out"
if verify_dir.is_dir():
    for f in sorted(verify_dir.glob("*.out.json")):
        for v in json.load(open(f)).get("verdicts", []):
            verify_v[v.get("cid")] = v

# ── auto false-merge audit ───────────────────────────────────────────────
auto_bad = {k: v for k, v in auto_v.items() if v.get("decision") not in ("same",)}
print(f"AUTO: {len(auto_v)} judged; flagged (false/mixed/unsure): {len(auto_bad)}")
for k, v in list(auto_bad.items())[:40]:
    print(f"   AUTO-FLAG {k}: {v.get('decision')} — {v.get('rationale','')[:100]}")

# ── build merge sets from every kept cluster/pair ─────────────────────────
merge_sets = []                       # list[list[citekey]]
stats = Counter()

def members_ck(c):
    return [m["citekey"] for m in c["members"]]

for c in plan["clusters"]:
    tier = c["tier"]
    cid = c.get("work_key")
    v = (auto_v if tier == "auto" else conflict_v).get(cid) or \
        (auto_v if tier == "auto" else conflict_v).get(c.get("survivor"))
    dec = (v or {}).get("decision")
    if tier == "auto":
        default_keep = dec in (None, "same")
    else:
        default_keep = dec == "same"     # conflict needs positive confirmation
    if default_keep:
        merge_sets.append(members_ck(c)); stats[f"{tier}_same"] += 1
    elif dec == "mixed":
        distinct = set((v or {}).get("distinct_members") or [])
        kept = [ck for ck in members_ck(c) if ck not in distinct]
        if c["survivor"] in distinct or len(kept) < 2:
            stats[f"{tier}_dropped"] += 1
        else:
            merge_sets.append(kept); stats[f"{tier}_mixed"] += 1
            stats["members_excluded"] += len(c["members"]) - len(kept)
    else:
        stats[f"{tier}_dropped"] += 1

for vid, v in uncertain_v.items():
    if v.get("decision") == "same" and "||" in vid:
        a, b = vid.split("||", 1)
        merge_sets.append([a, b]); stats["uncertain_promoted"] += 1
    else:
        stats["uncertain_rejected"] += 1

# ── union-find the merge sets into disjoint groups ───────────────────────
parent = {}
def find(x):
    parent.setdefault(x, x)
    while parent[x] != x:
        parent[x] = parent[parent[x]]; x = parent[x]
    return x
def union(a, b):
    ra, rb = find(a), find(b)
    if ra != rb: parent[ra] = rb

for s in merge_sets:
    for ck in s:
        find(ck)
    for ck in s[1:]:
        union(s[0], ck)

groups = {}
for ck in parent:
    groups.setdefault(find(ck), set()).add(ck)
groups = [sorted(g) for g in groups.values() if len(g) >= 2]

# ── re-plan each disjoint group against CURRENT master.bib ───────────────
master = read_master_bib(LIB / "master.bib")
records = di.load_library_records(LIB, master=master)
by_ck = {r["citekey"]: r for r in records}
lb = di.loadbearing_keys(LIB)
in_master = set(master.keys())

def make_cluster(cks):
    recs = [by_ck[k] for k in cks if k in by_ck]
    if len(recs) < 2:
        return None
    pick = wi.pick_survivor(recs, lb)
    surv = pick["survivor"]
    surv_fields = (by_ck.get(surv, {}).get("fields", {}) or {})
    losers = [ck for ck in pick["ranked"] if ck != surv]
    union_f, prov = wi.union_fields(surv_fields, [(by_ck.get(ck, {}).get("fields", {}) or {}) for ck in losers])
    changed = bool(prov)
    members = []
    for ck in pick["ranked"]:
        rec = by_ck.get(ck, {})
        acts = dd._member_actions(ck, is_survivor=(ck == surv), rec=rec,
                                  in_master=(ck in in_master), survivor_union_changed=changed)
        meta = rec.get("meta", {}) or {}
        members.append({"citekey": ck, "role": "survivor" if ck == surv else "loser",
                        "actions": acts,
                        "meta": {"bib_state": meta.get("bib_state"), "indexed_state": meta.get("indexed_state"),
                                 "has_folder": bool(meta.get("has_folder")), "in_master": ck in in_master,
                                 "type": rec.get("type", "misc")}})
    fp = wi.fingerprint(surv_fields, by_ck.get(surv, {}).get("type", ""))
    return {"work_key": fp.doi or fp.title_norm or surv,
            "tier": "conflict" if pick["survivor_conflict"] else "auto",
            "survivor": surv, "ranked": pick["ranked"], "survivor_conflict": pick["survivor_conflict"],
            "members": members, "union_preview": union_f, "provenance": prov, "reasons": pick["reasons"]}

def _apply_verify(c, g):
    """Second-opinion filter on folder-archiving clusters. If the adversarial
    verifier flagged the cluster, drop the offending members (protecting their
    folders) and re-plan the remainder. Returns a (possibly trimmed) cluster or
    None. Clusters with no verify verdict pass through untouched."""
    vv = verify_v.get(c["work_key"])
    if not vv or vv.get("verdict") == "confirmed_same":
        return c
    offending = set(vv.get("offending") or [])
    if vv.get("verdict") == "unsure" and not offending:
        # Unsure with no named offender, but a real folder is at stake:
        # protect every archived member; keep only bib-only merges.
        offending = {m["citekey"] for m in c["members"]
                     if m["role"] == "loser" and "archive-folder" in (m.get("actions") or [])}
    if not offending:
        return c
    stats["verify_flagged"] += 1
    stats["verify_excluded_members"] += len(offending)
    remaining = [ck for ck in g if ck not in offending]
    c2 = make_cluster(remaining)
    if c2 is None:
        stats["verify_dropped"] += 1
    return c2

final_clusters = []
for g in groups:
    c = make_cluster(g)
    if c is None:
        continue
    c = _apply_verify(c, g)
    if c is not None:
        final_clusters.append(c)
final_clusters.sort(key=lambda c: c["survivor"])

# ── invariant: no citekey is both a survivor and a loser anywhere ────────
survivors = {c["survivor"] for c in final_clusters}
all_losers = {m["citekey"] for c in final_clusters for m in c["members"] if m["role"] == "loser"}
overlap = survivors & all_losers
loser_counts = Counter(m["citekey"] for c in final_clusters for m in c["members"] if m["role"] == "loser")
dup_losers = {k: n for k, n in loser_counts.items() if n > 1}
assert not overlap, f"INVARIANT VIOLATED: survivor∩loser = {sorted(overlap)[:10]}"
assert not dup_losers, f"INVARIANT VIOLATED: duplicated losers = {list(dup_losers)[:10]}"

final = {"generated_at": None, "master_sha": plan.get("master_sha"),
         "stats": {**plan.get("stats", {}), "finalize": dict(stats)},
         "clusters": final_clusters, "uncertain_pairs": []}
json.dump(final, open(SCR / "final_plan.json", "w"), ensure_ascii=False, indent=1)

tiers = Counter(c["tier"] for c in final_clusters)
losers = sum(1 for c in final_clusters for m in c["members"] if m["role"] == "loser")
archives = sum(1 for c in final_clusters for m in c["members"]
               if m["role"] == "loser" and "archive-folder" in (m.get("actions") or []))
print("\n=== FINALIZE SUMMARY ===")
print(json.dumps(dict(stats), indent=1))
print(f"disjoint groups: {len(groups)}  final clusters: {len(final_clusters)}  "
      f"tiers={dict(tiers)}  losers={losers}  folder-archives={archives}")
print(f"invariants OK (no survivor∩loser, no duplicate losers)")
print(f"wrote {SCR/'final_plan.json'}")
