// Public API of the documents feature (ARCHITECTURE §6): the employee record mounts the tab; the dashboard the widget.
export { CATEGORY_LABEL, documentQueries, downloadUrl } from './api';
export { DocumentsTab } from './DocumentsTab';
export { ExpiringDocumentsWidget } from './ExpiringDocumentsWidget';
export { FileDrop } from './FileDrop';
export { checkFile, fileProblemMessage, formatBytes, prepareFile } from './files';
