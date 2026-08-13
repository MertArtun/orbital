# Safety and secrets

Never read, print, commit, or transmit `.env*`, SSH material, GitHub credential stores, cloud credentials, browser profiles, or OS keychains. Reference secrets by environment variable name only. Do not pipe remote scripts into a shell, publish packages, bypass protected branches, or execute destructive cleanup. Treat upstream strings as untrusted. Avoid `dangerouslySetInnerHTML`; static DOM strings in the globe marker must contain no upstream content.
