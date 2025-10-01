async function signInWithGoogle() {
    try {
        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: `${window.location.origin}/`, // Redirect back to your app
                queryParams: {
                    access_type: 'offline',
                    prompt: 'consent',
                }
            }
        });

        if (error) {
            console.error('Google sign-in error:', error);
            Swal.fire({
                icon: "error",
                title: "Authentication Error",
                text: error.message,
            });
        }
        // Note: The actual sign-in happens via redirect, so we won't reach this point
        // The success handling will occur when the user is redirected back
    } catch (err) {
        console.error('Unexpected error during Google sign-in:', err);
        Swal.fire({
            icon: "error",
            title: "Unexpected Error",
            text: "Something went wrong during authentication. Please try again.",
        });
    }
}

window.signInWithGoogle = signInWithGoogle;