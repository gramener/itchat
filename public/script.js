import { html, render } from "https://cdn.jsdelivr.net/npm/lit-html/+esm";
import { Marked } from "https://cdn.jsdelivr.net/npm/marked@13/+esm";
import { unsafeHTML } from "https://cdn.jsdelivr.net/npm/lit-html@3/directives/unsafe-html.js";

const { token } = await fetch("https://llmfoundry.straive.com/token", { credentials: "include" }).then((r) => r.json());
if (token) document.querySelector("#app").classList.remove("d-none");
else document.querySelector("#login").classList.remove("d-none");

const app = document.getElementById("app");
const requestsContainer = document.getElementById("requests");
const aiSummary = document.getElementById("ai-summary");
const marked = new Marked();

const loadingSpinner = html`
  <div class="text-center mt-4">
    <div class="spinner-border" role="status">
      <span class="visually-hidden">Loading...</span>
    </div>
  </div>
`;

app.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("ticket").value;
  render(loadingSpinner, aiSummary);
  render(html``, requestsContainer);

  let data;

  try {
    const response = await fetch(`requests?email=${encodeURIComponent(email)}`);
    data = await response.json();
  } catch (error) {
    render(html`Error fetching ticket data: ${error.message}`, requestsContainer);
    render(html``, aiSummary);
    return;
  }

  // Render table immediately after data is fetched
  render(
    html`
      <div class="table-responsive">
        <table class="table table-striped table-hover">
          <thead>
            <tr>
              <th>Display ID</th>
              <th>Subject</th>
              <th>Status</th>
              <th>Technician</th>
              <th>Created Time</th>
              <th>Due By Time</th>
            </tr>
          </thead>
          <tbody>
            ${data.requests.map(
              (request) => html`
                <tr>
                  <td><a href="https://servicedesk.straive.com/app/itdesk/ui/requests/${request.id}/details">${request.display_id}</a></td>
                  <td>${request.subject}</td>
                  <td>${request.status.name}</td>
                  <td>${request.technician?.email_id || "N/A"}</td>
                  <td>${request.created_time.display_value}</td>
                  <td>${request.due_by_time?.display_value || "N/A"}</td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
    `,
    requestsContainer,
  );

  // Prepare summary for AI
  const ticketSummary = data.requests
    .map(
      (r) => `
    Display ID: ${r.display_id}
    Subject: ${r.subject}
    Status: ${r.status.name}
    Technician: ${r.technician?.email_id || "N/A"}
    Created: ${r.created_time.display_value}
    Due By: ${r.due_by_time?.display_value || "N/A"}
  `,
    )
    .join("\n\n");

  // Fetch AI response
  try {
    const aiResponse = await fetch("https://llmfoundry.straive.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a helpful customer service agent. Explain to the user if they have any open tickets and when they'll get resolved. If none are open, explain the status of their most recent ticket or two. Here is the status of the user's tickets",
          },
          { role: "user", content: ticketSummary },
        ],
      }),
    });
    const aiData = await aiResponse.json();
    const summary = aiData.choices?.[0]?.message?.content || aiData.error?.message || "Unable to generate summary";
    render(unsafeHTML(marked.parse(summary)), document.getElementById("ai-summary"));
  } catch (error) {
    render(html`Error generating AI summary: ${error.message}`, aiSummary);
  }
});
