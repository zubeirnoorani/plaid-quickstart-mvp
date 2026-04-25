const API_HOST = import.meta.env.VITE_API_HOST?.replace(/\/$/, "") ?? "";

export const apiUrl = (path: `/api/${string}`) => `${API_HOST}${path}`;
