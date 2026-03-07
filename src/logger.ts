let verbose = false;

export function setVerbose(enabled: boolean): void {
  verbose = enabled;
}

export function isVerbose(): boolean {
  return verbose;
}

/** Write a debug message to stderr (only when verbose mode is on). */
export function debug(message: string): void {
  if (verbose) {
    process.stderr.write(`[DEBUG] ${message}\n`);
  }
}
