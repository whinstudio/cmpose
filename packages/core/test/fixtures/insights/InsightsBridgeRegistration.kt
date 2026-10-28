package dev.cmpose.app

import dev.cmpose.app.core.insights.IosInsights
import dev.cmpose.app.core.insights.IosInsightsBridge

fun registerInsightsBridge(bridge: IosInsightsBridge) = IosInsights.register(bridge)
