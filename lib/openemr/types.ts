/**
 * The standard OpenEMR REST API wraps every response in this envelope. `data`
 * is a single object or an array depending on the endpoint, so callers pass the
 * concrete shape as the type parameter, e.g. `OpenEmrResponse<Patient[]>`.
 */
export type OpenEmrResponse<T> = {
  validationErrors: unknown[];
  internalErrors: unknown[];
  data: T;
  links?: Record<string, string>;
};

/** Subset of the OpenEMR patient record the app relies on. */
export type Patient = {
  id: number;
  uuid: string;
  pid: number;
  pubpid: string;
  title: string;
  fname: string;
  mname: string;
  lname: string;
  DOB: string;
  sex: string;
  status: string;
  email: string;
  phone_home: string;
  phone_cell: string;
  street: string;
  city: string;
  state: string;
  postal_code: string;
  country_code: string;
  // OpenEMR returns many more columns; keep them available without listing all.
  [key: string]: unknown;
};

export type Encounter = {
  eid: number;
  euuid: string;
  date: string;
  reason: string;
  class_title: string;
  pc_catname: string; // display label for the appointment/event category (e.g. "Office Visit")
  facility_name: string;
};

export type SoapNote = {
  id: number;
  pid: number;
  date: string;
  user: string;
  authorized: number; // whether the note is signed/authorized. 1: signed, 0: not signed
  activity: number; // whether the note is active. 1: active, 0: deleted/inactive (soft deleted)
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
};
