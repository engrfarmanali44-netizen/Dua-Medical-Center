"use client";
import { createContext, useContext } from "react";

export type PortalUser = {
  id: string;
  username: string;
  email?: string | null;
  is_superuser: boolean;
  roles: string[];
  permissions: string[];
};

const PortalUserContext = createContext<PortalUser | null>(null);

export const PortalUserProvider = PortalUserContext.Provider;

export function usePortalUser(): PortalUser {
  const user = useContext(PortalUserContext);
  if (!user) throw new Error("usePortalUser must be used inside the portal layout");
  return user;
}
