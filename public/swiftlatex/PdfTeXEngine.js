"use strict";
/********************************************************************************
 * Copyright (C) 2019 Elliott Wen.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/
var exports = {};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
exports.__esModule = true;
exports.PdfTeXEngine = exports.CompileResult = exports.EngineStatus = void 0;
var EngineStatus;
(function (EngineStatus) {
    EngineStatus[EngineStatus["Init"] = 1] = "Init";
    EngineStatus[EngineStatus["Ready"] = 2] = "Ready";
    EngineStatus[EngineStatus["Busy"] = 3] = "Busy";
    EngineStatus[EngineStatus["Error"] = 4] = "Error";
})(EngineStatus = exports.EngineStatus || (exports.EngineStatus = {}));
// Patched from upstream: derive the worker URL from this script's own URL so
// it survives subdirectory deploys (e.g. GitHub Pages at /virgil/) instead of
// hardcoding the root-relative path.
var ENGINE_PATH = (function () {
    try {
        var src = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || '';
        if (src) return src.replace(/[^/]*$/, 'swiftlatexpdftex.js');
    } catch (e) {}
    return '/swiftlatex/swiftlatexpdftex.js';
})();
var CompileResult = /** @class */ (function () {
    function CompileResult() {
        this.pdf = undefined;
        this.status = -254;
        this.log = 'No log';
        // PATCHED (virgil): packages the worker could not resolve while offline.
        this.offlineMisses = [];
        // PATCHED (virgil, task 454): packages whose DOWNLOAD failed (mirror
        // 5xx / rate-limit / network), as {name, reason}. Distinct from
        // offlineMisses: those were never attempted, these were and failed.
        this.downloadFailures = [];
    }
    return CompileResult;
}());
exports.CompileResult = CompileResult;
var PdfTeXEngine = /** @class */ (function () {
    function PdfTeXEngine() {
        this.latexWorker = undefined;
        this.latexWorkerStatus = EngineStatus.Init;
        // PATCHED (virgil, task 454): streaming durability + progress sinks.
        this.assetCallback = undefined;
        this.fetchProgressCallback = undefined;
        this.streamChannelInstalled = false;
    }
    PdfTeXEngine.prototype.loadEngine = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (this.latexWorker !== undefined) {
                            throw new Error('Other instance is running, abort()');
                        }
                        this.latexWorkerStatus = EngineStatus.Init;
                        return [4 /*yield*/, new Promise(function (resolve, reject) {
                                _this.latexWorker = new Worker(ENGINE_PATH);
                                _this.latexWorker.onmessage = function (ev) {
                                    var data = ev['data'];
                                    var cmd = data['result'];
                                    if (cmd === 'ok') {
                                        _this.latexWorkerStatus = EngineStatus.Ready;
                                        resolve();
                                    }
                                    else {
                                        _this.latexWorkerStatus = EngineStatus.Error;
                                        // PATCHED (virgil): reject with an Error, not bare reject().
                                        // A bare reject() surfaces as "Compile failed: undefined";
                                        // an Error carries a real message up to the CompileService.
                                        // Must survive re-vendoring the worker.
                                        reject(new Error('SwiftLaTeX worker failed to boot'));
                                    }
                                };
                                // PATCHED (virgil): a worker load/runtime error during boot must
                                // reject the boot promise (upstream leaves onerror unset here, so a
                                // failed boot hangs forever). Must survive re-vendoring.
                                _this.latexWorker.onerror = function (err) {
                                    _this.latexWorkerStatus = EngineStatus.Error;
                                    reject(err instanceof Error ? err : new Error('SwiftLaTeX worker error during boot'));
                                };
                            })];
                    case 1:
                        _a.sent();
                        this.latexWorker.onmessage = function (_) {
                        };
                        this.latexWorker.onerror = function (_) {
                        };
                        // PATCHED (virgil, task 454): install the persistent
                        // streaming channel. See the comment above this file's
                        // `onAsset` / `onFetchProgress` setters.
                        this.installStreamChannel();
                        return [2 /*return*/];
                }
            });
        });
    };
    PdfTeXEngine.prototype.isReady = function () {
        return this.latexWorkerStatus === EngineStatus.Ready;
    };
    PdfTeXEngine.prototype.checkEngineStatus = function () {
        if (!this.isReady()) {
            throw Error('Engine is still spinning or not ready yet!');
        }
    };
    PdfTeXEngine.prototype.compileLaTeX = function () {
        return __awaiter(this, void 0, void 0, function () {
            var start_compile_time, res;
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        this.checkEngineStatus();
                        this.latexWorkerStatus = EngineStatus.Busy;
                        start_compile_time = performance.now();
                        return [4 /*yield*/, new Promise(function (resolve, reject) {
                                _this.latexWorker.onmessage = function (ev) {
                                    var data = ev['data'];
                                    var cmd = data['cmd'];
                                    if (cmd !== "compile")
                                        return;
                                    var result = data['result'];
                                    var log = data['log'];
                                    var status = data['status'];
                                    _this.latexWorkerStatus = EngineStatus.Ready;
                                    console.log('Engine compilation finish ' + (performance.now() - start_compile_time));
                                    var nice_report = new CompileResult();
                                    nice_report.status = status;
                                    nice_report.log = log;
                                    if (result === 'ok') {
                                        var pdf = new Uint8Array(data['pdf']);
                                        nice_report.pdf = pdf;
                                    }
                                    // PATCHED (virgil): surface the offline-miss set the worker
                                    // recorded (kpse lookups it skipped while offline) so the
                                    // CompileService can report "package X unavailable offline".
                                    // Must survive re-vendoring the worker.
                                    nice_report.offlineMisses = data['offlineMisses'] || [];
                                    // PATCHED (virgil, task 454).
                                    nice_report.downloadFailures = data['downloadFailures'] || [];
                                    resolve(nice_report);
                                };
                                // PATCHED (virgil): capture `reject` (executor param above was `_`)
                                // and wire the worker's error channels to it, so a worker crash /
                                // uncaught error settles the in-flight compile instead of hanging
                                // the promise forever (upstream leaves these as silent no-ops, which
                                // is why a dead worker permanently wedges the spinner). The
                                // CompileService catches this rejection and reboots the engine.
                                // Must survive re-vendoring the worker.
                                _this.latexWorker.onerror = function (err) {
                                    _this.latexWorkerStatus = EngineStatus.Error;
                                    reject(err instanceof Error ? err : new Error('SwiftLaTeX worker error during compile'));
                                };
                                _this.latexWorker.onmessageerror = function () {
                                    _this.latexWorkerStatus = EngineStatus.Error;
                                    reject(new Error('SwiftLaTeX worker message error during compile'));
                                };
                                _this.latexWorker.postMessage({ 'cmd': 'compilelatex' });
                                console.log('Engine compilation start');
                            })];
                    case 1:
                        res = _a.sent();
                        this.latexWorker.onmessage = function (_) {
                        };
                        return [2 /*return*/, res];
                }
            });
        });
    };
    /* Internal Use */
    PdfTeXEngine.prototype.compileFormat = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        this.checkEngineStatus();
                        this.latexWorkerStatus = EngineStatus.Busy;
                        return [4 /*yield*/, new Promise(function (resolve, reject) {
                                _this.latexWorker.onmessage = function (ev) {
                                    var data = ev['data'];
                                    var cmd = data['cmd'];
                                    if (cmd !== "compile")
                                        return;
                                    var result = data['result'];
                                    var log = data['log'];
                                    // const status: number = data['status'] as number;
                                    _this.latexWorkerStatus = EngineStatus.Ready;
                                    if (result === 'ok') {
                                        var formatArray = data['pdf']; /* PDF for result */
                                        var formatBlob = new Blob([formatArray], { type: 'application/octet-stream' });
                                        var formatURL_1 = URL.createObjectURL(formatBlob);
                                        setTimeout(function () { URL.revokeObjectURL(formatURL_1); }, 30000);
                                        console.log('Download format file via ' + formatURL_1);
                                        resolve();
                                    }
                                    else {
                                        reject(log);
                                    }
                                };
                                _this.latexWorker.postMessage({ 'cmd': 'compileformat' });
                            })];
                    case 1:
                        _a.sent();
                        this.latexWorker.onmessage = function (_) {
                        };
                        return [2 /*return*/];
                }
            });
        });
    };
    PdfTeXEngine.prototype.setEngineMainFile = function (filename) {
        this.checkEngineStatus();
        if (this.latexWorker !== undefined) {
            this.latexWorker.postMessage({ 'cmd': 'setmainfile', 'url': filename });
        }
    };
    PdfTeXEngine.prototype.writeMemFSFile = function (filename, srccode) {
        this.checkEngineStatus();
        if (this.latexWorker !== undefined) {
            this.latexWorker.postMessage({ 'cmd': 'writefile', 'url': filename, 'src': srccode });
        }
    };
    PdfTeXEngine.prototype.makeMemFSFolder = function (folder) {
        this.checkEngineStatus();
        if (this.latexWorker !== undefined) {
            if (folder === '' || folder === '/') {
                return;
            }
            this.latexWorker.postMessage({ 'cmd': 'mkdir', 'url': folder });
        }
    };
    PdfTeXEngine.prototype.flushCache = function () {
        this.checkEngineStatus();
        if (this.latexWorker !== undefined) {
            // console.warn('Flushing');
            this.latexWorker.postMessage({ 'cmd': 'flushcache' });
        }
    };
    PdfTeXEngine.prototype.setTexliveEndpoint = function (url) {
        // Upstream nulls this.latexWorker here, which destroys the engine
        // after a single call. Drop that line so the engine stays usable.
        if (this.latexWorker !== undefined) {
            this.latexWorker.postMessage({ 'cmd': 'settexliveurl', 'url': url });
        }
    };
    // PATCHED (virgil): TeX-asset provisioning surface (P1 offline-assets).
    // These three methods drive the additive worker cases (seedcache /
    // dumpnewcache / setoffline) so the main-thread tex-assets layer can seed
    // the kpse cache before compile, write-through freshly fetched assets to
    // IndexedDB, and put the worker in fail-fast offline mode. Must survive
    // re-vendoring the worker (they mirror the existing postMessage method
    // style; nothing here reaches into worker internals directly).
    //
    // seedCache(cacheKey, fileid, src): fire-and-forget — write bytes into the
    // worker's memfs and register them in texlive200_cache so a later kpse
    // lookup for `cacheKey` is byte-identical to a real mirror fetch.
    PdfTeXEngine.prototype.seedCache = function (cacheKey, fileid, src) {
        if (this.latexWorker !== undefined) {
            var buf = src instanceof Uint8Array ? src.buffer : src;
            this.latexWorker.postMessage({ 'cmd': 'seedcache', 'cacheKey': cacheKey, 'fileid': fileid, 'src': buf });
        }
    };
    // dumpNewCache(): request/response round-trip returning the cacheKey ->
    // {fileid, bytes} entries added to texlive200_cache since the last dump.
    // Installs a temporary onmessage handler, restores the no-op after.
    PdfTeXEngine.prototype.dumpNewCache = function () {
        var _this = this;
        return new Promise(function (resolve) {
            if (_this.latexWorker === undefined) {
                resolve([]);
                return;
            }
            // PATCHED (virgil, task 454): bound the wait. This is a
            // request/response round trip, and a worker blocked inside a
            // synchronous compile pass cannot process the request AT ALL — so
            // an unbounded await here wedges its caller forever on exactly the
            // path (a hang) where someone is most likely to reach for it.
            // Durability rides the STREAMING channel instead; this batch is the
            // belt-and-braces drain for a worker that is idle.
            var settled = false;
            var timer = setTimeout(function () {
                if (settled) return;
                settled = true;
                _this.latexWorker && (_this.latexWorker.onmessage = function (_) { });
                resolve([]);
            }, 5000);
            _this.latexWorker.onmessage = function (ev) {
                var data = ev['data'];
                if (data['cmd'] !== 'dumpnewcache')
                    return;
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                _this.latexWorker.onmessage = function (_) { };
                resolve(data['entries'] || []);
            };
            _this.latexWorker.postMessage({ 'cmd': 'dumpnewcache' });
        });
    };
    // setOffline(value): fire-and-forget — flip the worker's offline flag so
    // uncached kpse lookups fail fast (return 0 + record miss) instead of
    // hanging on a synchronous cross-origin XHR that ignores its timeout.
    PdfTeXEngine.prototype.setOffline = function (value) {
        if (this.latexWorker !== undefined) {
            this.latexWorker.postMessage({ 'cmd': 'setoffline', 'value': !!value });
        }
    };
    // PATCHED (virgil, task 454): STREAMING DURABILITY + PROGRESS CHANNEL.
    //
    // `onAsset(cb)` is called with {cacheKey, fileid, bytes} the instant the
    // worker finishes downloading a TeX asset — NOT at the end of the compile.
    // `onFetchProgress(cb)` is called with the asset's name when a download
    // STARTS. Both ride an addEventListener('message') listener installed once
    // at boot, which the per-call `onmessage` swaps cannot clobber.
    //
    // Why this exists: `dumpNewCache()` is a request/response round trip, so it
    // can only run when the worker is IDLE. A compile that times out leaves the
    // worker blocked forever and `closeWorker()` then destroys its in-memory
    // texlive200_cache — so every byte that compile downloaded was thrown away
    // and the next attempt restarted from an empty cache. A cold compile too
    // slow to finish in one budget could therefore never converge. Streaming
    // makes each download durable the moment it lands.
    //
    // Must survive re-vendoring the worker.
    PdfTeXEngine.prototype.installStreamChannel = function () {
        var _this = this;
        if (this.latexWorker === undefined || this.streamChannelInstalled) {
            return;
        }
        this.streamChannelInstalled = true;
        this.latexWorker.addEventListener('message', function (ev) {
            var data = ev['data'];
            if (!data) {
                return;
            }
            if (data['cmd'] === 'assetfetched') {
                if (_this.assetCallback) {
                    try {
                        _this.assetCallback({
                            cacheKey: data['cacheKey'],
                            fileid: data['fileid'],
                            bytes: data['bytes'],
                        });
                    }
                    catch (err) { /* a durability sink must never break a compile */ }
                }
            }
            else if (data['cmd'] === 'kpsefetch') {
                if (_this.fetchProgressCallback) {
                    try {
                        _this.fetchProgressCallback(data['name']);
                    }
                    catch (err) { /* a progress sink must never break a compile */ }
                }
            }
        });
    };
    PdfTeXEngine.prototype.onAsset = function (cb) {
        this.assetCallback = cb;
        this.installStreamChannel();
    };
    PdfTeXEngine.prototype.onFetchProgress = function (cb) {
        this.fetchProgressCallback = cb;
        this.installStreamChannel();
    };
    PdfTeXEngine.prototype.closeWorker = function () {
        if (this.latexWorker !== undefined) {
            this.latexWorker.postMessage({ 'cmd': 'grace' });
            this.latexWorker = undefined;
        }
        // PATCHED (virgil, task 454): drop the PROGRESS sink and KEEP the
        // DURABILITY sink, deliberately.
        //
        // `closeWorker` does not `terminate()` — it posts 'grace' and drops our
        // reference, so a worker blocked mid-compile keeps running as an ORPHAN
        // (still issuing its synchronous package fetches) until that compile
        // unwinds and it processes the message. Its listener holds this engine
        // alive, so those late downloads still reach the asset sink and are
        // still worth persisting: they are exactly the packages the next
        // attempt would otherwise re-fetch.
        //
        // The progress sink is per-ATTEMPT bookkeeping, so it MUST be dropped —
        // an orphan's fetches counted against the next attempt would make a
        // dead hang look productive and keep the continuation loop going.
        this.fetchProgressCallback = undefined;
        this.streamChannelInstalled = false;
    };
    return PdfTeXEngine;
}());
exports.PdfTeXEngine = PdfTeXEngine;
if (typeof window !== 'undefined') {
    window.PdfTeXEngine = PdfTeXEngine;
}

