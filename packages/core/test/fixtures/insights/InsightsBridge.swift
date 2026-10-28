import FirebaseAnalytics
import FirebaseCrashlytics
import Shared

// Crashlytics and Analytics for core:insights; a no-op without GoogleService-Info.plist
final class InsightsBridge: IosInsightsBridge {
    private let firebaseConfigured: Bool

    init(firebaseConfigured: Bool) {
        self.firebaseConfigured = firebaseConfigured
    }

    func isEnabled() -> Bool { firebaseConfigured }

    func log(message: String) {
        Crashlytics.crashlytics().log(message)
    }

    func logEvent(name: String, params: [String: String]) {
        Analytics.logEvent(name, parameters: params)
    }
}
