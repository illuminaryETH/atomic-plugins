//! Mailgun email client for sending magic links

use crate::error::CloudError;

pub struct MailgunClient {
    api_key: String,
    domain: String,
    from: String,
    http: reqwest::Client,
}

impl MailgunClient {
    pub fn new(api_key: String, domain: String, from: String) -> Self {
        Self {
            api_key,
            domain,
            from,
            http: reqwest::Client::new(),
        }
    }

    pub async fn send_magic_link(
        &self,
        to: &str,
        link: &str,
    ) -> Result<(), CloudError> {
        let url = format!(
            "https://api.mailgun.net/v3/{}/messages",
            self.domain
        );

        let resp = self
            .http
            .post(&url)
            .basic_auth("api", Some(&self.api_key))
            .form(&[
                ("from", self.from.as_str()),
                ("to", to),
                ("subject", "Sign in to Atomic Cloud"),
                ("html", &format!(
                    r#"<div style="font-family: -apple-system, system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
  <h1 style="font-size: 24px; font-weight: normal; margin-bottom: 24px;">Sign in to Atomic</h1>
  <p style="color: #4a4540; line-height: 1.6; margin-bottom: 32px;">Click the button below to sign in to your dashboard. This link expires in 15 minutes.</p>
  <a href="{link}" style="display: inline-block; background: #7c3aed; color: white; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-weight: 500;">Sign in</a>
  <p style="color: #8a8580; font-size: 13px; margin-top: 32px;">If you didn't request this, you can ignore this email.</p>
</div>"#
                )),
            ])
            .send()
            .await
            .map_err(|e| CloudError::Internal(format!("Mailgun request failed: {e}")))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(CloudError::Internal(format!("Mailgun send failed: {body}")));
        }

        Ok(())
    }
}
