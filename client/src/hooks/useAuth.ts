import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import type { AuthUser, LoginResult, OAuthProviders, TwoFactorMethod } from "@/lib/types";

/** Current user, or null when not authenticated (a 401 resolves to null, not an error). */
export function useMe() {
  return useQuery({
    queryKey: ["me"],
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<AuthUser | null> => {
      try {
        return (await api.get<{ user: AuthUser }>("/auth/me")).data.user;
      } catch {
        return null;
      }
    },
  });
}

/** Which OAuth provider buttons to show (only those the server has credentials for). */
export function useOAuthProviders() {
  return useQuery({
    queryKey: ["auth", "providers"],
    staleTime: Infinity,
    queryFn: async () => (await api.get<OAuthProviders>("/auth/providers")).data,
  });
}

export function useSignup() {
  return useMutation({
    mutationFn: async (body: { email: string; password: string; name?: string }) =>
      (await api.post<{ user: AuthUser }>("/auth/signup", body)).data.user,
    onSuccess: (user) => {
      queryClient.clear();
      queryClient.setQueryData(["me"], user);
    },
  });
}

export function useLogin() {
  return useMutation({
    mutationFn: async (body: { email: string; password: string; remember?: boolean }): Promise<LoginResult> => {
      const data = (
        await api.post<{ user?: AuthUser; requires2fa?: boolean; methods?: TwoFactorMethod[] }>(
          "/auth/signin",
          body
        )
      ).data;
      // 2FA-enabled accounts return a challenge instead of a user; the caller
      // routes to the verify step and no session exists yet.
      if (data.requires2fa) return { requires2fa: true, methods: data.methods ?? ["totp"] };
      return { requires2fa: false, user: data.user! };
    },
    onSuccess: (result) => {
      queryClient.clear(); // never carry a previous user's cached data across a login
      if (!result.requires2fa) queryClient.setQueryData(["me"], result.user);
    },
  });
}

/** Complete the login 2FA challenge (pending cookie → real session on success). */
export function useVerify2fa() {
  return useMutation({
    mutationFn: async (body: { method: TwoFactorMethod; code: string }) =>
      (await api.post<{ user: AuthUser }>("/auth/2fa/verify", body)).data.user,
    onSuccess: (user) => {
      queryClient.clear();
      queryClient.setQueryData(["me"], user);
    },
  });
}

/** Ask the server to email a one-time code during the login 2FA step. */
export function useSend2faEmail() {
  return useMutation({
    mutationFn: async () => (await api.post("/auth/2fa/email")).data,
  });
}

export function useLogout() {
  return useMutation({
    mutationFn: async () => (await api.post("/auth/logout")).data,
    onSuccess: () => queryClient.clear(),
  });
}

/**
 * Close the account and delete everything in it.
 *
 * The cache is cleared rather than invalidated: every query in it belongs to a
 * user who no longer exists, and refetching them would only produce 401s.
 */
export function useDeleteAccount() {
  return useMutation({
    mutationFn: async (body: { email: string; password?: string }) =>
      (await api.delete("/auth/account", { data: body })).data,
    onSuccess: () => queryClient.clear(),
  });
}

/** True when the wealth (Net Worth) section should be visible for the current session. */
export function useCanSeeWealth(): boolean {
  const { data: me } = useMe();
  if (!me) return false;
  return me.mode === "superadmin" || !me.wealthLockEnabled;
}

/**
 * The server decides per session mode whether to redact the net-worth figure
 * (dashboard + reports) and whether the wealth routes 403. So when the mode flips,
 * every cached payload that depends on it is wrong: without this, unlocking would
 * reveal the Net Worth card still showing a stale ₹0, and the Net Worth page would
 * keep serving its cached 403 until the 30s staleTime elapsed.
 */
function invalidateWealthViews() {
  queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  queryClient.invalidateQueries({ queryKey: ["reports"] });
  queryClient.invalidateQueries({ queryKey: ["holdings"] });
  queryClient.invalidateQueries({ queryKey: ["networth"] });
}

/** Enter superadmin (wealth) mode with the passcode. */
export function useUnlockWealth() {
  return useMutation({
    mutationFn: async (passcode: string) =>
      (await api.post<{ user: AuthUser }>("/auth/unlock-wealth", { passcode })).data.user,
    onSuccess: (user) => {
      queryClient.setQueryData(["me"], user);
      invalidateWealthViews();
    },
  });
}

/** Return to the everyday (user) view, re-hiding wealth. */
export function useLockWealth() {
  return useMutation({
    mutationFn: async () => (await api.post<{ user: AuthUser }>("/auth/lock-wealth")).data.user,
    onSuccess: (user) => {
      queryClient.setQueryData(["me"], user);
      invalidateWealthViews();
    },
  });
}

/**
 * Forgot the wealth passcode: mail a one-time code to the account address.
 * Resolves with that address, masked, so the UI can say where the code went.
 */
export function useRequestWealthReset() {
  return useMutation({
    mutationFn: async () =>
      (await api.post<{ ok: true; email: string }>("/auth/wealth-passcode/reset-request")).data.email,
  });
}

/** Redeem the emailed code to set a new passcode; the session comes back unlocked. */
export function useResetWealthPasscode() {
  return useMutation({
    mutationFn: async (body: { code: string; passcode: string }) =>
      (await api.post<{ user: AuthUser }>("/auth/wealth-passcode/reset", body)).data.user,
    onSuccess: (user) => {
      queryClient.setQueryData(["me"], user);
      invalidateWealthViews();
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

/** Confirm an email from the link's token; on success the server also signs us in. */
export function useVerifyEmail() {
  return useMutation({
    mutationFn: async (token: string) =>
      (await api.post<{ user: AuthUser }>("/auth/verify-email", { token })).data.user,
    onSuccess: (user) => {
      // Drop the pre-verification cache, but keep the ["me"] query itself alive.
      // VerifyEmailPage redirects reactively off useMe(); clearing the cache
      // wholesale destroys that observer, so the fresh user set below would never
      // reach the component and the page sits on "Verifying…" forever.
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
      queryClient.setQueryData(["me"], user);
    },
  });
}

/** Ask the server to re-send the verification email to the signed-in user. */
export function useResendVerification() {
  return useMutation({
    mutationFn: async () => (await api.post("/auth/resend-verification")).data,
  });
}

/** Request a password-reset email. Always "succeeds" — the server never reveals whether the email exists. */
export function useForgotPassword() {
  return useMutation({
    mutationFn: async (email: string) => (await api.post("/auth/forgot-password", { email })).data,
  });
}

/** Consume a reset-password link's token; on success the server also signs us in. */
export function useResetPassword() {
  return useMutation({
    mutationFn: async (body: { token: string; password: string }) =>
      (await api.post<{ user: AuthUser }>("/auth/reset-password", body)).data.user,
    onSuccess: (user) => {
      queryClient.clear();
      queryClient.setQueryData(["me"], user);
    },
  });
}

/** Change (or, for OAuth-only accounts, set for the first time) the signed-in user's password. */
export function useChangePassword() {
  return useMutation({
    mutationFn: async (body: { currentPassword?: string; newPassword: string }) =>
      (await api.post("/auth/change-password", body)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me"] }),
  });
}
