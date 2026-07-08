/**
 * Slack Incoming Webhook 알림 — SLACK_WEBHOOK_URL 환경변수 필요.
 * 텔레메트리 성격: 실패해도 throw 하지 않는다(호출부 흐름을 막지 않음).
 * 웹훅 미설정이면 조용히 스킵.
 */
export async function postSlack(text: string): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (e) {
    console.warn("[Slack] 알림 실패:", e instanceof Error ? e.message : e);
  }
}
