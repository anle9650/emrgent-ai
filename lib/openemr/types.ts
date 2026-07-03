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
