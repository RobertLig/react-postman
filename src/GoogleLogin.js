import { useEffect } from "react";

function GoogleLogin() {

    function handleCredentialResponse(response) {
        console.log("ID TOKEN:", response.credential);

        fetch("http://localhost:8080/auth/google", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ idToken: response.credential })
        })
            .then(res => res.json())
            .then(data => console.log("Backend response:", data))
            .catch(err => console.error("Error:", err));
    }

    useEffect(() => {
        /* global google */
        if (!window.google) {
            console.error("Google script not loaded");
            return;
        }

        google.accounts.id.initialize({
            client_id: "456614025207-m4ljumnedhiku3qo8t2fgci9r02ukoci.apps.googleusercontent.com",
            callback: handleCredentialResponse
        });

        google.accounts.id.renderButton(
            document.getElementById("googleSignInButton"),
            { theme: "outline", size: "large" }
        );
    }, []);

    return (
        <div>
            <h2>Google Login Test</h2>
            <div id="googleSignInButton"></div>
        </div>
    );
}

export default GoogleLogin;
