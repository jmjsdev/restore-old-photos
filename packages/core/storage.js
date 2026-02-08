// In-memory storage — lost on restart

export const photos = new Map()
export const jobs = new Map()

// Track running processes per job so they can be killed on cancel
export const runningProcs = new Map()
