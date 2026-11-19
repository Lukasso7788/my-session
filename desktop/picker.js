let selected;
window.screenPicker.onSources(({ sources, audio }) => {
  document.getElementById("audioLabel").hidden = !audio;
  for (const source of sources) {
    const button = document.createElement("button");
    button.className = "source";
    button.setAttribute("aria-pressed", "false");
    const image = document.createElement("img");
    image.src = source.image; image.alt = "";
    const label = document.createElement("span");
    label.textContent = source.name;
    button.append(image, label);
    button.onclick = () => {
      document.querySelectorAll(".source").forEach(item => item.setAttribute("aria-pressed", "false"));
      button.setAttribute("aria-pressed", "true");
      selected = source.id;
      document.getElementById("share").disabled = false;
    };
    document.getElementById("sources").append(button);
  }
});
document.getElementById("cancel").onclick = () => window.screenPicker.choose(null);
document.getElementById("share").onclick = () => window.screenPicker.choose(selected, document.getElementById("audio").checked);
