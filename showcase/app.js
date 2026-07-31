import { mountFixloop } from "./fixloop.js";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tracker = document.querySelector(".tracker");
const reportId = document.querySelector("[data-report-id]");
const status = document.querySelector(".status");
const events = [...document.querySelectorAll(".event")];

async function simulate(payload) {
  await delay(650);
  return {
    id: crypto.randomUUID().replaceAll("-", "").slice(0, 24),
    status: "received",
    payload
  };
}

function animate(result) {
  reportId.textContent = result.id;
  tracker.dataset.visible = "true";
  tracker.scrollIntoView({ behavior: "smooth", block: "center" });
  events.forEach((event) => event.classList.remove("active"));
  const states = ["RECEIVED", "ROUTED", "FILED", "FIXING", "VERIFIED"];
  states.forEach((label, index) => {
    setTimeout(() => {
      events[index].classList.add("active");
      status.textContent = label;
    }, index * 700);
  });
}

mountFixloop({
  title: "Report a bug",
  repositories: [
    { value: "example/storefront", label: "Storefront" },
    { value: "example/api", label: "API" }
  ],
  cssUrl: "./styles.css",
  submit: simulate,
  onSubmitted: animate
});
