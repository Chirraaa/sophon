# Microsoft accounts

Sophon connects to Outlook and Microsoft 365 through Microsoft Graph, signing in
with your own Azure app registration. Nothing is hosted by Sophon, and the app
registration has **no client secret**.

## Register the app (once, about two minutes)

1. Open the [Azure portal app registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) and choose **New registration**.
2. Name it (for example "Sophon"). Under **Supported account types** choose
   **Accounts in any organizational directory and personal Microsoft accounts**.
3. Under **Redirect URI** choose **Public client/native (mobile & desktop)** and
   enter `http://localhost`. Sophon uses a temporary port on localhost; Microsoft
   ignores the port for loopback addresses.
4. Register, then on **Authentication** confirm **Allow public client flows** is
   **Yes**.
5. On **API permissions** add Microsoft Graph **Delegated** permissions
   `User.Read` and `Calendars.ReadWrite` (`offline_access`, `openid`, `profile`
   and `email` are standard sign-in scopes). Work or school tenants may require an
   administrator to approve them.
6. Copy the **Application (client) ID** from the Overview page.

## Connect in Sophon

In **Settings > Plugins > Microsoft accounts**, paste the ID, select **Save**, then
**Connect a Microsoft account**. Sign-in opens your default browser; Microsoft
shows its account chooser, so a browser that is already signed in is never used
silently. Use **Add another account** to connect more, and **Use this account** to
switch the active one.

## What is stored and requested

- Requested permissions: sign-in (`openid profile email offline_access`),
  `User.Read` and `Calendars.ReadWrite`. Mail permissions are not requested.
- Tokens and account details are encrypted with the operating system
  (Electron `safeStorage`) in `microsoft-auth.enc`. They never reach the interface
  or the model; the interface receives names, addresses and whether the calendar is
  allowed.
- The application ID is locked while accounts are connected, because their
  sign-ins belong to that registration. Remove the accounts to change it.
- **Remove** forgets an account on this computer. Microsoft offers no token
  revocation for public clients, so to cut off access completely remove the app
  under Microsoft account > Privacy > Apps and services (or your organization's
  _My Apps_ page).
- An expired or revoked sign-in marks the account **Signed out** and asks you to
  reconnect it. A refresh failure for one account never affects the others.

## Limits

Sign-in is verified (signature, issuer, tenant, audience, nonce) and uses PKCE.
The calendar tools that use these accounts are described in
[Calendar](CALENDAR.md).
Admin consent policies, conditional access and multi-factor requirements are
Microsoft's and can block sign-in.

Validation: `npm run smoke:microsoft` (protocol, account store, loopback flow with
a signed-token fixture; no network) and `npm run smoke:microsoft:ui` (built
app, disposable profile).
