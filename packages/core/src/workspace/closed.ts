/**
 * Said when something uses a site after it was closed: one that kept it (an
 * extension, a plugin, a preview's controller), or a save or git work still
 * waiting when it closed. What closes a site: the registry, after an hour
 * without use (unless its preview is running, a job is, or an Undo is still
 * offered on it); removing it; putting a backup back; the app stopping.
 */
export const SITE_CLOSED = "This site has been closed, so it can't be used from here any more. Open it again to go on.";
