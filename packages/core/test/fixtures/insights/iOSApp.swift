import SwiftUI
// cmpose:firebase
import FirebaseCore
// /cmpose:firebase
import Shared

@main
struct iOSApp: App {
    init() {
        // cmpose:firebase
        let firebaseConfigured = Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil
        if firebaseConfigured { FirebaseApp.configure() }
        // /cmpose:firebase
        MainViewControllerKt.startKoinAtLaunch()
        // cmpose:backend
        SignInBridgeRegistrationKt.registerSignInBridge(bridge: SignInBridge())
        // /cmpose:backend
        InsightsBridgeRegistrationKt.registerInsightsBridge(bridge: InsightsBridge(firebaseConfigured: firebaseConfigured))
        // Google Mobile Ads lives in Swift (AdsBridge.swift); Kotlin reaches it through this bridge.
        AdsBridgeRegistrationKt.registerAdsBridge(bridge: AdsBridge())
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
