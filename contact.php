<?php
// Check if the form is submitted
if ($_SERVER["REQUEST_METHOD"] == "POST") {
    // Get the form fields
    $name = $_POST['name'];
    $subject = $_POST['subject'];
    $message = $_POST['message'];

    // Set the recipient email address
    $to = 'removed@realfiction.live';

    // Set the email subject
    $email_subject = "New Contact Form Submission: $subject";

    // Build the email content
    $email_body = "You have received a new message from the RealFiction contact form.\n\n" .
        "Name: $name\n" .
        "Subject: $subject\n" .
        "Message:\n$message\n";

    // Set the email headers
    $headers = "From: $name\n";
    $headers .= "Reply-To: $name\n";

    // Send the email
    if (mail($to, $email_subject, $email_body, $headers)) {
        // If the email is sent successfully, redirect to a thank you page
        header('Location: thank_you.html');
        exit; // Ensure that script execution stops after the redirect
    } else {
        // If there is an error sending the email, display an error message
        echo 'Sorry, an error occurred. Please try again later.';
    }
} else {
    // If the form is not submitted, redirect to the contact page
    header('Location: contact.html');
    exit; // Ensure that script execution stops after the redirect
}
?>
