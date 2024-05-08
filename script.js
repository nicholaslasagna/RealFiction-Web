const mobileNav = document.querySelector(".hamburger");
const navbar = document.querySelector(".menubar");

const toggleNav = () => {
  navbar.classList.toggle("active");
  mobileNav.classList.toggle("hamburger-active");
};
mobileNav.addEventListener("click", () => toggleNav());

// Get the element with the ID "ip"
var element = document.getElementById("ip");
var tooltip; // Declare tooltip variable outside event listener scope

// Add mouseover event listener to the element
element.addEventListener("mouseover", function() {
  // Change cursor style to default
  element.style.cursor = "default";

  // Create a tooltip element if it doesn't exist
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.textContent = "Click To Copy Server Address";
    tooltip.style.position = "absolute";
    tooltip.style.backgroundColor = "rgba(0, 0, 0, 0.8)";
    tooltip.style.color = "#fff";
    tooltip.style.padding = "5px";
    tooltip.style.borderRadius = "5px";
    tooltip.style.zIndex = "9999";

    // Set tooltip position
    tooltip.style.top = (event.clientY - 30) + "px";
    tooltip.style.left = (event.clientX + 20) + "px";

    // Append the tooltip to the body
    document.body.appendChild(tooltip);
  }
});

// Add mouseout event listener to the element
element.addEventListener("mouseout", function() {
  // Reset cursor style to default
  element.style.cursor = "pointer";

  // Remove the tooltip if it exists
  if (tooltip) {
    document.body.removeChild(tooltip);
    tooltip = null; // Reset tooltip variable
  }
});

// Add click event listener to the element
element.addEventListener("click", function() {
  // Create a temporary textarea element
  var textarea = document.createElement("textarea");

  // Set the value of the textarea to the text content of the element
  textarea.value = element.textContent.trim();

  // Append the textarea to the body
  document.body.appendChild(textarea);

  // Select the text inside the textarea
  textarea.select();

  // Execute the copy command
  document.execCommand("copy");

  // Remove the textarea
  document.body.removeChild(textarea);

  // Alert the user that the text has been copied
  alert("Copied: " + element.textContent.trim());
});

function initServerData(serverIp,serverPort){
    // our function will take 2 parameters
    console.log(serverIp);
    console.log(serverPort);
}

initServerData("play.dawn-mc.net","25565");
