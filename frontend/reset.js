import {
    createClient
} from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";


const SUPABASE_URL =
    "https://ibsyrfulsxlnitilxcaa.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
    "sb_publishable_LQE8u0QjUgfAHfT3iHpbYA_miu-Dnxk";

const supabaseClient =
    createClient(
        SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY
    );

const resetStatus =
    document.getElementById("resetStatus");

const resetPasswordForm =
    document.getElementById("resetPasswordForm");

const newPasswordInput =
    document.getElementById("newPasswordInput");

const confirmPasswordInput =
    document.getElementById("confirmPasswordInput");

const saveNewPasswordButton =
    document.getElementById("saveNewPasswordButton");

let recoverySessionReady = false;


supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY" && session) {
        recoverySessionReady = true;
        resetStatus.textContent =
            "Choose a new password for your account.";
        resetPasswordForm.hidden =
            false;
    }
});


async function checkRecoveryLink() {
    const {
        data: { session },
        error,
    } = await supabaseClient.auth.getSession();

    if (error || !session) {
        resetStatus.textContent =
            "This reset link is invalid or expired. Request a new one from the login page.";
        return;
    }

    if (!recoverySessionReady) {
        resetStatus.textContent =
            "Open this page from the password reset link in your email.";
    }
}


function getPasswordUpdateErrorMessage(error) {
    const errorDetails =
        `${error?.code ?? ""} ${error?.message ?? error ?? ""}`.toLowerCase();

    if (/same_password|different.*old|same as.*old|same password/.test(errorDetails)) {
        return "Choose a password that is different from your old password.";
    }

    if (/expired|invalid.*token|session_not_found|recovery.*invalid/.test(errorDetails)) {
        return "This reset link has expired or is invalid. Request a new one and try again.";
    }

    if (/weak/.test(errorDetails)) {
        return "This password is too weak. Choose a stronger password.";
    }

    if (/short|length|character|at least \d+|minimum/.test(errorDetails)) {
        return "This password is too short. Choose a longer password.";
    }

    return error?.message ||
        "The password could not be updated. Please try again.";
}


async function saveNewPassword(event) {
    event.preventDefault();

    const newPassword =
        newPasswordInput.value;

    if (!newPassword) {
        resetStatus.textContent =
            "Enter a new password.";
        return;
    }

    if (newPassword !== confirmPasswordInput.value) {
        resetStatus.textContent =
            "The passwords do not match.";
        return;
    }

    saveNewPasswordButton.disabled =
        true;
    resetStatus.textContent =
        "Updating your password...";

    try {
        const { error } =
            await supabaseClient.auth.updateUser({
                password: newPassword,
            });

        if (error) {
            console.error("Password update error:", error);
            resetStatus.textContent =
                getPasswordUpdateErrorMessage(error);
            return;
        }

        resetStatus.textContent =
            "Password updated. Redirecting to login...";
        await supabaseClient.auth.signOut({ scope: "local" });
        window.setTimeout(() => {
            window.location.replace("index.html?password_reset=success");
        }, 800);
    } catch (error) {
        console.error("Password update error:", error);
        resetStatus.textContent =
            getPasswordUpdateErrorMessage(error);
    } finally {
        saveNewPasswordButton.disabled =
            false;
    }
}


resetPasswordForm.addEventListener(
    "submit",
    saveNewPassword
);

checkRecoveryLink().catch(error => {
    console.error("Password reset link error:", error);
    resetStatus.textContent =
        "We couldn't verify this reset link. Request a new one from the login page.";
});