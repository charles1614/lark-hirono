let _verbose = false;
export function initLogging(v: boolean) { _verbose = v; }
export function verbose() { return _verbose; }
export function log(msg: string) { if (_verbose) console.error(msg); }
export function logError(msg: string) { console.error(msg); }
