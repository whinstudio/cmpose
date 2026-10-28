plugins {
    alias(libs.plugins.androidApplication)
    alias(libs.plugins.composeCompiler)
    // cmpose:firebase
    alias(libs.plugins.googleServices) apply false
    alias(libs.plugins.firebaseCrashlytics) apply false
    // /cmpose:firebase
}

android {
    namespace = "dev.cmpose.app"
}

// cmpose:firebase
// The Firebase plugins run only with the developer's own google-services.json
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
    apply(plugin = "com.google.firebase.crashlytics")
}
// /cmpose:firebase
