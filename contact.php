<?php
if ($_SERVER["REQUEST_METHOD"] == "POST") {
    // Get the form fields
    $name = $_POST["name"];
    $subject = $_POST["subject"];
    $message = $_POST["message"];

    // Construct the email body
    $email_body = "Minecraft Username or Name: $name\n\n";
    $email_body .= "Subject: $subject\n\n";
    $email_body .= "Message:\n$message";

    // Email information
    $to = "removed@realfiction.live";
    $subject = "New Inquiry from RealFiction Contact Form";
    $headers = "From: $name <noreply@realfiction.live>";

    // Send email
    if (mail($to, $subject, $email_body, $headers)) {
        echo "Thank you for your inquiry. We'll get back to you soon!";
    } else {
        echo "Sorry, there was an error sending your message.";
    }
} else {
    // Not a POST request, redirect back to the contact form
    header("Location: contact.html");
}
?>
