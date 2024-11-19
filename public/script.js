import { html, render } from "https://cdn.jsdelivr.net/npm/lit-html/+esm";
import { Marked } from "https://cdn.jsdelivr.net/npm/marked@13/+esm";
import { unsafeHTML } from "https://cdn.jsdelivr.net/npm/lit-html@3/directives/unsafe-html.js";

const { token } = await fetch("https://llmfoundry.straive.com/token", { credentials: "include" }).then((r) => r.json());
if (token) document.querySelector("#app").classList.remove("d-none");
else document.querySelector("#login").classList.remove("d-none");

const app = document.getElementById("app");
const requestsContainer = document.getElementById("requests");
const assentContainer = document.getElementById("assent");
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
  render(loadingSpinner, requestsContainer);
  render(loadingSpinner, assentContainer);

  let servicedeskRequests;
  let assentRequests;

  try {
    await Promise.all([
      fetch(`assent?strRequestorEmpEmail=${encodeURIComponent(email)}`)
        .then((response) => response.json())
        .then((data) => redraw((assentRequests = data)))
        .catch((error) => {
          render(html`Error fetching assent data: ${error.message}`, assentContainer);
        }),
      fetch(`requests?email=${encodeURIComponent(email)}`)
        .then((response) => response.json())
        .then((data) => redraw((servicedeskRequests = data)))
        .catch((error) => {
          render(html`Error fetching ticket data: ${error.message}`, requestsContainer);
        }),
    ]);
  } catch (e) {
    console.error(e);
  }

  function redraw() {
    if (assentRequests)
      render(
        html`
          <h2 class="h5">Assent Requests</h2>
          <div class="table-responsive">
            <table class="table table-striped table-hover">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Category</th>
                  <th>ServiceRequest</th>
                  <th>Description</th>
                  <th>RequestNo</th>
                  <th>Requestor</th>
                  <th>On Behalf Of</th>
                  <th>RequestedDate</th>
                  <th>Amount</th>
                  <th>SDTicketNo</th>
                </tr>
              </thead>
              <tbody>
                ${assentRequests.value.map(
                  (request) => html`
                    <tr>
                      <td>${request.strStatus}</td>
                      <td>${request.strCategory}</td>
                      <td>${request.strServiceRequest}</td>
                      <td>${request.strDescription}</td>
                      <td>${request.strRequestNo}</td>
                      <td>${request.strRequestorName} #${request.strRequestorEmpNo}</td>
                      <td>${request.strOnBehalfOfName} #${request.strOnBehalfOfEmpNo}</td>
                      <td>${request.dtRequestedDate}</td>
                      <td>${request.strAmount}</td>
                      <td>${request.dtStartDate}</td>
                      <td>${request.dtEndDate}</td>
                      <td>${request.strSDTicketNo}</td>
                    </tr>
                  `
                )}
              </tbody>
            </table>
          </div>
        `,
        assentContainer
      );
    if (servicedeskRequests)
      render(
        html`
          <h2 class="h5">ServiceDesk Requests</h2>
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
                ${servicedeskRequests.requests.map(
                  (request) => html`
                    <tr>
                      <td><a href="https://servicedesk.straive.com/app/itdesk/ui/requests/${request.id}/details">${request.display_id}</a></td>
                      <td>${request.subject}</td>
                      <td>${request.status.name}</td>
                      <td>${request.technician?.email_id || "N/A"}</td>
                      <td>${request.created_time.display_value}</td>
                      <td>${request.due_by_time?.display_value || "N/A"}</td>
                    </tr>
                  `
                )}
              </tbody>
            </table>
          </div>
        `,
        requestsContainer
      );
  }

  // Render table immediately after data is fetched
  // Prepare summary for AI
  const servidedeskSummary = servicedeskRequests
    ? servicedeskRequests.requests
        .map((r) =>
          `
Display ID: ${r.display_id}
Subject: ${r.subject}
Status: ${r.status.name}
Technician: ${r.technician?.email_id || "N/A"}
Created: ${r.created_time.display_value}
Due By: ${r.due_by_time?.display_value || "N/A"}
`.trim()
        )
        .join("\n\n")
    : "";

  const assentSummary = assentRequests
    ? assentRequests.value
        .map((r) =>
          `
Status: ${r.strStatus}
ServiceRequest: ${r.strServiceRequest}
Description: ${r.strDescription}
Requested on: ${r.dtRequestedDate}
Amount: ${r.strAmount}
`.trim()
        )
        .join("\n\n")
    : "";

  // Fetch AI response
  render(loadingSpinner, aiSummary);
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
            content: `You are a helpful customer service agent.
Explain to the user if they have any open tickets on ServiceDesk or Assent, and when they'll get resolved.
If none are open, explain the status of their most recent ticket or two.
Here is the status of the user's tickets.
`,
          },
          { role: "user", content: `# ServicesDesk tickets\n\n${servidedeskSummary}\n\n# Assent requests\n\n${assentSummary}` },
        ],
      }),
    });
    const aiData = await aiResponse.json();
    const summary = aiData.choices?.[0]?.message?.content ?? (aiData.error ? JSON.stringify(aiData.error) : "Unable to generate summary");
    render(unsafeHTML(marked.parse(summary)), document.getElementById("ai-summary"));
  } catch (error) {
    render(html`Error generating AI summary: ${error.message}`, aiSummary);
  }
});
