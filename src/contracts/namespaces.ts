/** Namespaces and project keys — shared by the catalog HTTP interface and the CLI. */

/** One entry of `GET /api/namespaces`; `POST`/`PATCH /api/namespaces` return it without `libraries`. */
export interface NamespaceResponse {
  id: string;
  display_name: string;
  /** The system namespace (`insights`) takes no assignments and no project-key pushes. */
  system: boolean;
  created_at: string;
  libraries: string[];
}

/** `POST /api/namespaces`: 201, 400 `invalid_id`, 409 `exists`. */
export interface CreateNamespaceRequest {
  id: string;
  display_name: string;
}

/** `PATCH /api/namespaces/:id`. */
export interface RenameNamespaceRequest {
  display_name: string;
}

/** `PUT /api/libraries/:id/namespace`: 200, 404 `not_found`, 400 `system_namespace`. */
export interface AssignLibraryRequest {
  namespace_id: string;
}

/** `PUT /api/libraries/:id/namespace`: 200. */
export interface AssignLibraryResponse {
  id: string;
  namespace_id: string;
}

/** One entry of `GET /api/project-keys[?namespace=]`. The key itself is never listed. */
export interface ProjectKeyResponse {
  id: string;
  name: string;
  prefix: string;
  namespace_id: string;
  library_id: string | null;
  created_by: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

/** `POST /api/project-keys`. */
export interface CreateProjectKeyRequest {
  namespace_id: string;
  name: string;
  library_id?: string;
}

/** `POST /api/project-keys`: 201. `key` (`lpk_…`) is shown only here. */
export interface CreateProjectKeyResponse {
  id: string;
  name: string;
  prefix: string;
  namespace_id: string;
  library_id: string | null;
  key: string;
}
