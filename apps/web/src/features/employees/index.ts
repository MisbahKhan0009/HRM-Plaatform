// Public API of the employees feature (frontend ARCHITECTURE §6): pages for routes, the picker for other features.
export {
  type DirectorySearch,
  directoryQuery,
  directorySortValues,
  employeeQueries,
  ensureOr404,
} from './api';
export { type EmployeeOption, EmployeePicker, type EmployeePickerProps } from './components/employee-picker';
export { DirectoryPage } from './pages/directory-page';
export { ImportPage } from './pages/import-page';
export { MyProfileChangesPage } from './pages/my-profile-changes-page';
export { MyProfilePage } from './pages/my-profile-page';
export { NewEmployeePage } from './pages/new-employee-page';
export { ProfileChangeReviewPage } from './pages/profile-change-review-page';
export { EmployeeRecordPage, type RecordTab, recordTabValues } from './pages/record-page';
export { PeopleOverviewWidget } from './widgets';
