import "dart:async";

import "package:flutter/material.dart";
import "package:flutter/services.dart";
import "package:google_mobile_ads/google_mobile_ads.dart";

import "api.dart";
import "config.dart";
import "format.dart";
import "theme.dart";

class RootPage extends StatelessWidget {
  const RootPage({super.key});

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    if (state.booting) return const _Splash();
    if (state.user == null && state.bootError != null) return const ServerPage();
    if (state.user == null) return const AuthPage();
    return const ShellPage();
  }
}

class _Splash extends StatelessWidget {
  const _Splash();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      backgroundColor: EarnColors.ink,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            _Mark(),
            SizedBox(height: 16),
            Text("EarnZA", style: TextStyle(color: Colors.white, fontSize: 36, fontWeight: FontWeight.w700)),
          ],
        ),
      ),
    );
  }
}

class ServerPage extends StatefulWidget {
  const ServerPage({super.key});

  @override
  State<ServerPage> createState() => _ServerPageState();
}

class _ServerPageState extends State<ServerPage> {
  TextEditingController? url;
  String? error;
  bool busy = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    url ??= TextEditingController(text: AppScope.of(context).apiBase);
  }

  @override
  void dispose() {
    url?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            const _Mark(),
            const SizedBox(height: 16),
            const Text("EarnZA needs its server", style: TextStyle(fontSize: 28, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            Text(state.bootError ?? "Start the API, then try again.", style: const TextStyle(color: EarnColors.muted, height: 1.4)),
            const SizedBox(height: 16),
            TextField(controller: url, decoration: const InputDecoration(labelText: "Server address")),
            if (error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(error!, style: const TextStyle(color: EarnColors.danger))),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: busy
                  ? null
                  : () async {
                      setState(() { busy = true; error = null; });
                      try {
                        await state.setApiBase(url!.text);
                      } on ApiException catch (err) {
                        setState(() => error = err.message);
                      } finally {
                        if (mounted) setState(() => busy = false);
                      }
                    },
              child: Text(busy ? "Connecting…" : "Connect"),
            ),
          ],
        ),
      ),
    );
  }
}

class AuthPage extends StatefulWidget {
  const AuthPage({super.key});

  @override
  State<AuthPage> createState() => _AuthPageState();
}

class _AuthPageState extends State<AuthPage> {
  final name = TextEditingController();
  final email = TextEditingController();
  final password = TextEditingController();
  final referral = TextEditingController();
  final resetToken = TextEditingController();
  String mode = "login";
  String? error;
  bool busy = false;

  @override
  void dispose() {
    name.dispose();
    email.dispose();
    password.dispose();
    referral.dispose();
    resetToken.dispose();
    super.dispose();
  }

  Future<void> run(Future<void> Function() action) async {
    setState(() { busy = true; error = null; });
    try {
      await action();
    } on ApiException catch (err) {
      setState(() => error = err.message);
    } catch (err) {
      setState(() => error = err.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final demo = state.config.demoMode;
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(24, 28, 24, 24),
          children: [
            const _Mark(),
            const SizedBox(height: 18),
            const Text("EarnZA", style: TextStyle(fontSize: 40, fontWeight: FontWeight.w800, color: EarnColors.ink)),
            const Text("Watch a short ad. Earn Rands.", style: TextStyle(color: EarnColors.muted, fontSize: 16)),
            const SizedBox(height: 22),
            if (mode == "signup") TextField(controller: name, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: "Name")),
            if (mode != "reset") ...[
              const SizedBox(height: 12),
              TextField(controller: email, keyboardType: TextInputType.emailAddress, decoration: const InputDecoration(labelText: "Email")),
            ],
            if (mode != "forgot") ...[
              const SizedBox(height: 12),
              TextField(controller: password, obscureText: true, decoration: InputDecoration(labelText: mode == "reset" ? "New password" : "Password")),
            ],
            if (mode == "signup") ...[
              const SizedBox(height: 12),
              TextField(controller: referral, textCapitalization: TextCapitalization.characters, decoration: const InputDecoration(labelText: "Referral code (optional)")),
            ],
            if (mode == "reset") ...[
              const SizedBox(height: 12),
              TextField(controller: resetToken, decoration: const InputDecoration(labelText: "Reset code")),
            ],
            if (error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(error!, style: const TextStyle(color: EarnColors.danger))),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: busy ? null : () => run(() async {
                final app = AppScope.of(context);
                if (mode == "login") {
                  await app.login(email.text, password.text);
                } else if (mode == "signup") {
                  await app.signup(name.text, email.text, password.text, referral.text);
                } else if (mode == "forgot") {
                  final token = await app.forgot(email.text);
                  if (!context.mounted) return;
                  if (token == null) {
                    setState(() => error = "If that account exists, a reset email is on its way.");
                  } else {
                    resetToken.text = token;
                    setState(() => mode = "reset");
                  }
                } else {
                  await app.resetPassword(resetToken.text, password.text);
                  if (!context.mounted) return;
                  setState(() { mode = "login"; error = "Password updated. Sign in with the new one."; });
                }
              }),
              child: Text(busy ? "Please wait…" : mode == "login" ? "Sign in" : mode == "signup" ? "Create account" : mode == "forgot" ? "Send reset" : "Save password"),
            ),
            const SizedBox(height: 10),
            if (mode == "login")
              OutlinedButton.icon(
                onPressed: busy ? null : () => run(() => AppScope.of(context).google()),
                icon: const Icon(Icons.g_mobiledata, size: 28),
                label: Text(demo || !AppConfig.useFirebase ? "Continue with Google (demo)" : "Continue with Google"),
                style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(52), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14))),
              ),
            TextButton(
              onPressed: () => setState(() { mode = mode == "login" ? "signup" : "login"; error = null; }),
              child: Text(mode == "login" ? "New here? Create an account" : "Already have an account? Sign in"),
            ),
            if (mode == "login")
              TextButton(onPressed: () => setState(() { mode = "forgot"; error = null; }), child: const Text("Forgot password")),
            if (demo)
              Container(
                margin: const EdgeInsets.only(top: 8),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: const Color(0xFFF7F3E6), borderRadius: BorderRadius.circular(14)),
                child: const Text("Demo sign-in: thabo@earnza.local\nPassword: EarnZA-user-demo\nPoints are practice money until AdMob and payouts are live.", style: TextStyle(height: 1.35)),
              ),
          ],
        ),
      ),
    );
  }
}

class ShellPage extends StatefulWidget {
  const ShellPage({super.key});

  @override
  State<ShellPage> createState() => _ShellPageState();
}

class _ShellPageState extends State<ShellPage> {
  int index = 0;
  Timer? timer;

  @override
  void initState() {
    super.initState();
    timer = Timer.periodic(const Duration(seconds: 15), (_) async {
      if (!mounted) return;
      try {
        await AppScope.of(context).refresh();
      } catch (_) {}
    });
  }

  void openCash() => setState(() => index = 2);

  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final pages = const [HomeTab(), ActivityTab(), CashTab(), ProfileTab()];
    return Scaffold(
      body: SafeArea(child: pages[index]),
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (value) => setState(() => index = value),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home), label: "Home"),
          NavigationDestination(icon: Icon(Icons.receipt_long_outlined), selectedIcon: Icon(Icons.receipt_long), label: "Activity"),
          NavigationDestination(icon: Icon(Icons.payments_outlined), selectedIcon: Icon(Icons.payments), label: "Cash out"),
          NavigationDestination(icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person), label: "Profile"),
        ],
      ),
    );
  }
}

class HomeTab extends StatelessWidget {
  const HomeTab({super.key});

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final user = state.user!;
    final wallet = state.wallet!;
    return RefreshIndicator(
      onRefresh: state.refresh,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          Row(
            children: [
              const Text("EarnZA", style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
              const Spacer(),
              IconButton(
                onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const NoticesPage())),
                icon: Badge(isLabelVisible: state.unread > 0, label: Text("${state.unread}"), child: const Icon(Icons.notifications_none)),
              ),
            ],
          ),
          if (state.config.demoMode)
            Container(
              margin: const EdgeInsets.only(bottom: 12),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: const Color(0xFFFFF4D6), borderRadius: BorderRadius.circular(14)),
              child: const Text("Demo mode. Rewards are credited by your server after a simulated ad, not by a live AdMob payment."),
            ),
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(color: EarnColors.ink, borderRadius: BorderRadius.circular(28)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text("Your balance", style: TextStyle(color: Color(0xFFB7C4BC))),
                const SizedBox(height: 4),
                Text(formatZar(wallet.zar), style: const TextStyle(color: Colors.white, fontSize: 42, fontWeight: FontWeight.w800)),
                Text("${formatPoints(wallet.points)} points", style: const TextStyle(color: EarnColors.gold, fontSize: 16)),
                if (user.blocked) ...[
                  const SizedBox(height: 10),
                  Text(user.blockReason ?? "This account is blocked.", style: const TextStyle(color: Color(0xFFFFC9C4))),
                ],
                const SizedBox(height: 16),
                FilledButton(
                  style: FilledButton.styleFrom(backgroundColor: EarnColors.gold, foregroundColor: const Color(0xFF2A2108)),
                  onPressed: () => _openCash(context),
                  child: const Text("Cash out"),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(child: _Stat(label: "Ads today", value: "${wallet.adsToday}/${wallet.dailyAdCap}")),
              const SizedBox(width: 10),
              Expanded(child: _Stat(label: "Per ad", value: "${wallet.pointsPerAd} pts")),
            ],
          ),
          const SizedBox(height: 10),
          _Card(
            child: Row(
              children: [
                const Expanded(child: Text("Daily check-in", style: TextStyle(fontWeight: FontWeight.w700))),
                FilledButton(
                  onPressed: wallet.canCheckIn ? () => _guard(context, state.checkIn) : null,
                  child: Text(wallet.canCheckIn ? "+${wallet.checkInBonusPoints} pts" : "Done today"),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          const Text("Watch and earn", style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          _Card(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text("Rewarded video", style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                const SizedBox(height: 6),
                Text(watchHint(reason: wallet.canWatch ? null : wallet.watchBlockReason, pointsPerAd: wallet.pointsPerAd, dailyAdCap: wallet.dailyAdCap, seconds: wallet.secondsUntilNextAd), style: const TextStyle(color: EarnColors.muted, height: 1.35)),
                const SizedBox(height: 12),
                FilledButton(onPressed: wallet.canWatch && !user.blocked ? () => _watch(context) : null, child: const Text("Watch ad")),
              ],
            ),
          ),
          const SizedBox(height: 12),
          const Text("Earnings are small, capped, and not a job or a guaranteed income. A cash out stays pending until it is paid manually.", style: TextStyle(color: EarnColors.muted, fontSize: 12, height: 1.4)),
        ],
      ),
    );
  }

  void _openCash(BuildContext context) {
    context.findAncestorStateOfType<_ShellPageState>()?.openCash();
  }
}

class ActivityTab extends StatelessWidget {
  const ActivityTab({super.key});

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    return RefreshIndicator(
      onRefresh: state.refresh,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text("Activity", style: TextStyle(fontSize: 28, fontWeight: FontWeight.w800)),
          const SizedBox(height: 6),
          const Text("Points move only when the server records them.", style: TextStyle(color: EarnColors.muted)),
          const SizedBox(height: 12),
          if (state.ledger.isEmpty) const Text("No earnings yet. Watch an ad or check in."),
          for (final item in state.ledger) _Card(
            child: Row(
              children: [
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(item.note, style: const TextStyle(fontWeight: FontWeight.w700)),
                  Text(_when(item.createdAt), style: const TextStyle(color: EarnColors.muted, fontSize: 12)),
                ])),
                Text("${item.points > 0 ? "+" : ""}${formatPoints(item.points)}", style: TextStyle(fontWeight: FontWeight.w800, color: item.points >= 0 ? EarnColors.green : EarnColors.danger)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class CashTab extends StatefulWidget {
  const CashTab({super.key});

  @override
  State<CashTab> createState() => _CashTabState();
}

class _CashTabState extends State<CashTab> {
  final points = TextEditingController();
  bool seeded = false;
  final phone = TextEditingController();
  final holder = TextEditingController();
  final account = TextEditingController();
  final branch = TextEditingController();
  String method = "1voucher";
  String bank = "Capitec";
  String accountType = "savings";
  String? error;
  bool busy = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (seeded) return;
    final wallet = AppScope.of(context).wallet;
    if (wallet == null) return;
    seeded = true;
    points.text = "${wallet.points >= wallet.minPayoutPoints ? wallet.minPayoutPoints : wallet.points}";
  }

  @override
  void dispose() {
    points.dispose();
    phone.dispose();
    holder.dispose();
    account.dispose();
    branch.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final wallet = state.wallet!;
    final typed = int.tryParse(points.text) ?? 0;
    final preview = wallet.pointsPerZar == 0 ? 0 : typed / wallet.pointsPerZar;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        const Text("Cash out", style: TextStyle(fontSize: 28, fontWeight: FontWeight.w800)),
        const SizedBox(height: 6),
        Text("Minimum ${formatZar(wallet.minPayoutZar)}. You can choose 1Voucher or a South African bank account. Payment is manual.", style: const TextStyle(color: EarnColors.muted, height: 1.35)),
        const SizedBox(height: 14),
        if (wallet.pendingWithdrawalId != null)
          const _Card(child: Text("You already have a cash out waiting. It has to be paid or rejected before you can request another.")),
        TextField(controller: points, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: "Points to cash out")),
        const SizedBox(height: 8),
        Text("About ${formatZar(preview.toDouble())}", style: const TextStyle(fontWeight: FontWeight.w700)),
        const SizedBox(height: 12),
        SegmentedButton<String>(
          segments: const [
            ButtonSegment(value: "1voucher", label: Text("1Voucher")),
            ButtonSegment(value: "bank", label: Text("Bank")),
          ],
          selected: {method},
          onSelectionChanged: (value) => setState(() => method = value.first),
        ),
        const SizedBox(height: 12),
        if (method == "1voucher")
          TextField(controller: phone, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: "South African mobile", hintText: "0821234567"))
        else ...[
          TextField(controller: holder, decoration: const InputDecoration(labelText: "Account holder")),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            initialValue: bank,
            decoration: const InputDecoration(labelText: "Bank"),
            items: const ["ABSA", "African Bank", "Capitec", "Discovery Bank", "FNB", "Investec", "Nedbank", "Standard Bank", "TymeBank", "Other"].map((item) => DropdownMenuItem(value: item, child: Text(item))).toList(),
            onChanged: (value) => setState(() => bank = value ?? bank),
          ),
          const SizedBox(height: 10),
          TextField(controller: account, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: "Account number")),
          const SizedBox(height: 10),
          TextField(controller: branch, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: "Branch code")),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            initialValue: accountType,
            decoration: const InputDecoration(labelText: "Account type"),
            items: const [
              DropdownMenuItem(value: "cheque", child: Text("Cheque")),
              DropdownMenuItem(value: "savings", child: Text("Savings")),
              DropdownMenuItem(value: "transmission", child: Text("Transmission")),
            ],
            onChanged: (value) => setState(() => accountType = value ?? accountType),
          ),
        ],
        if (error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(error!, style: const TextStyle(color: EarnColors.danger))),
        const SizedBox(height: 16),
        FilledButton(
          onPressed: busy || wallet.pendingWithdrawalId != null
              ? null
              : () async {
                  setState(() { busy = true; error = null; });
                  try {
                    await state.requestCashOut({
                      "points": int.tryParse(points.text) ?? 0,
                      "method": method,
                      "phone": phone.text,
                      "accountHolder": holder.text,
                      "bankName": bank,
                      "accountNumber": account.text,
                      "branchCode": branch.text,
                      "accountType": accountType,
                    });
                    if (mounted) setState(() => error = null);
                  } on ApiException catch (err) {
                    setState(() => error = err.message);
                  } finally {
                    if (mounted) setState(() => busy = false);
                  }
                },
          child: Text(busy ? "Sending…" : "Request cash out"),
        ),
        const SizedBox(height: 18),
        const Text("History", style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
        for (final item in state.withdrawals) ...[
          const SizedBox(height: 8),
          _Card(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: [
                  Expanded(child: Text("${formatZar(item.zarAmount)} · ${item.method == "1voucher" ? "1Voucher" : item.bankName ?? "Bank"}", style: const TextStyle(fontWeight: FontWeight.w700))),
                  _Status(item.status),
                ]),
                Text(_when(item.createdAt), style: const TextStyle(color: EarnColors.muted, fontSize: 12)),
                if (item.status == "PAID" && item.voucherPin != null) Text("1Voucher PIN: ${item.voucherPin}", style: const TextStyle(fontWeight: FontWeight.w800)),
                if (item.status == "PAID" && item.paymentReference != null) Text("Bank reference: ${item.paymentReference}"),
                if (item.rejectionReason != null && item.status == "REJECTED") Text(item.rejectionReason!),
                if (item.status == "FROZEN") Text(item.frozenReason ?? "This cash out is frozen until the account is reviewed."),
              ],
            ),
          ),
        ],
      ],
    );
  }
}

class ProfileTab extends StatelessWidget {
  const ProfileTab({super.key});

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final user = state.user!;
    final wallet = state.wallet!;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        const Text("Profile", style: TextStyle(fontSize: 28, fontWeight: FontWeight.w800)),
        const SizedBox(height: 12),
        _Card(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(user.displayName, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
            Text(user.email, style: const TextStyle(color: EarnColors.muted)),
            const SizedBox(height: 8),
            Text("${user.adsWatched} verified ads · ${formatPoints(user.points)} points"),
            if (user.isEmulator) const Text("This device looks like an emulator.", style: TextStyle(color: EarnColors.danger)),
            if (user.isRooted) const Text("This phone looks rooted.", style: TextStyle(color: EarnColors.danger)),
          ]),
        ),
        const SizedBox(height: 10),
        _Card(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text("Your referral code", style: TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text(user.referralCode, style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800, letterSpacing: 2)),
            Text("You and a friend each get ${wallet.referralBonusPoints} points after their first verified ad. ${user.referralCount} joined."),
            TextButton(onPressed: () => Clipboard.setData(ClipboardData(text: user.referralCode)), child: const Text("Copy code")),
          ]),
        ),
        ListTile(title: const Text("Edit name"), trailing: const Icon(Icons.chevron_right), onTap: () => _rename(context)),
        ListTile(title: const Text("Notifications"), trailing: const Icon(Icons.chevron_right), onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const NoticesPage()))),
        ListTile(title: const Text("Help"), trailing: const Icon(Icons.chevron_right), onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const HelpPage()))),
        ListTile(title: const Text("Terms"), trailing: const Icon(Icons.chevron_right), onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const LegalPage(kind: "terms")))),
        ListTile(title: const Text("Privacy"), trailing: const Icon(Icons.chevron_right), onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const LegalPage(kind: "privacy")))),
        ListTile(title: const Text("Delete account"), onTap: () => _delete(context)),
        ListTile(title: const Text("Sign out"), onTap: state.logout),
      ],
    );
  }

  Future<void> _rename(BuildContext context) async {
    final state = AppScope.of(context);
    final controller = TextEditingController(text: state.user!.displayName);
    final next = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text("Your name"),
        content: TextField(controller: controller),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text("Cancel")),
          TextButton(onPressed: () => Navigator.pop(context, controller.text), child: const Text("Save")),
        ],
      ),
    );
    if (next == null || !context.mounted) return;
    try {
      await state.updateName(next);
    } on ApiException catch (err) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
    }
  }

  Future<void> _delete(BuildContext context) async {
    final state = AppScope.of(context);
    final yes = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text("Delete this account?"),
        content: const Text("Your sign-in will stop working. Bank details and voucher PINs stored here are removed. Open cash outs must be finished first."),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text("Keep account")),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text("Delete")),
        ],
      ),
    );
    if (yes != true || !context.mounted) return;
    try {
      await state.deleteAccount();
    } on ApiException catch (err) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
    }
  }
}

class NoticesPage extends StatelessWidget {
  const NoticesPage({super.key});

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text("Notifications"),
        actions: [
          TextButton(onPressed: state.unread == 0 ? null : state.markAllRead, child: const Text("Mark read")),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          for (final note in state.notifications)
            _Card(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(note.title, style: const TextStyle(fontWeight: FontWeight.w800)),
              Text(note.body),
              Text(_when(note.createdAt), style: const TextStyle(color: EarnColors.muted, fontSize: 12)),
            ])),
          if (state.notifications.isEmpty) const Text("Nothing yet. Cash-out updates show up here."),
        ],
      ),
    );
  }
}

class HelpPage extends StatelessWidget {
  const HelpPage({super.key});

  @override
  Widget build(BuildContext context) {
    const faqs = [
      ("How do I earn?", "You choose to watch a Google rewarded ad. Points are added only after the server checks Google's signed callback. The app does not trust the phone to say the ad finished."),
      ("How much is a point?", "The owner sets how many points make one Rand. The rate can change. What you already requested keeps the Rand amount from that moment."),
      ("Why is there a daily limit?", "So one phone cannot drain the ad budget. There is also a short wait between ads."),
      ("When do I get money?", "A cash out is a request. It stays pending until the owner pays a 1Voucher or a bank transfer outside the app and records the PIN or reference. That can take a few business days."),
      ("Why was I blocked?", "One account is allowed on a phone. An emulator, a rooted phone, a reward that Google did not confirm, or ads faster than a person can watch will block the account and hold a cash out. Other unusual activity is only flagged for review."),
      ("How do I delete my account?", "Profile, then Delete account. You need to finish any open cash out first."),
    ];
    return Scaffold(
      appBar: AppBar(title: const Text("Help")),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          for (final item in faqs)
            ExpansionTile(title: Text(item.$1), children: [Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 12), child: Text(item.$2))]),
          const SizedBox(height: 12),
          const Text("Support email is a placeholder: REPLACE_WITH_SUPPORT_EMAIL", style: TextStyle(color: EarnColors.muted)),
        ],
      ),
    );
  }
}

class LegalPage extends StatelessWidget {
  const LegalPage({required this.kind, super.key});
  final String kind;

  @override
  Widget build(BuildContext context) {
    final terms = kind == "terms";
    return Scaffold(
      appBar: AppBar(title: Text(terms ? "Terms" : "Privacy")),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: const Color(0xFFFFF4D6), borderRadius: BorderRadius.circular(14)),
            child: const Text("DRAFT — needs legal review before publishing. This is placeholder text, not legal advice, and it is not a finished terms or privacy policy."),
          ),
          const SizedBox(height: 12),
          Text(terms ? _terms : _privacy, style: const TextStyle(height: 1.45)),
        ],
      ),
    );
  }
}

class AdPage extends StatefulWidget {
  const AdPage({required this.sessionId, required this.userId, required this.demo, super.key});
  final String sessionId;
  final String userId;
  final bool demo;

  @override
  State<AdPage> createState() => _AdPageState();
}

class _AdPageState extends State<AdPage> {
  int left = 5;
  String status = "Playing a demo ad";
  Timer? timer;

  @override
  void initState() {
    super.initState();
    if (widget.demo) {
      timer = Timer.periodic(const Duration(seconds: 1), (tick) {
        if (left <= 1) {
          tick.cancel();
          _finishDemo();
        } else {
          setState(() => left -= 1);
        }
      });
    } else {
      unawaited(_showGoogleAd());
    }
  }

  Future<void> _finishDemo() async {
    setState(() => status = "Asking the server to credit this view…");
    try {
      await AppScope.of(context).completeDemoAd(widget.sessionId);
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (err) {
      if (mounted) setState(() => status = err.message);
    }
  }

  Future<void> _showGoogleAd() async {
    setState(() => status = "Loading a Google rewarded ad…");
    await MobileAds.instance.initialize();
    await RewardedAd.load(
      adUnitId: AdUnits.rewarded,
      request: const AdRequest(),
      rewardedAdLoadCallback: RewardedAdLoadCallback(
        onAdLoaded: (ad) async {
          await ad.setServerSideOptions(ServerSideVerificationOptions(userId: widget.userId, customData: widget.sessionId));
          var earned = false;
          ad.fullScreenContentCallback = FullScreenContentCallback(
            onAdDismissedFullScreenContent: (ad) async {
              ad.dispose();
              if (!earned) {
                if (mounted) setState(() => status = "The ad closed before a reward. No points were added.");
                return;
              }
              if (mounted) setState(() => status = "Waiting for Google to confirm this view with the server…");
              for (var i = 0; i < 8; i++) {
                await Future<void>.delayed(const Duration(seconds: 2));
                if (!mounted) return;
                await AppScope.of(context).refresh();
              }
              if (mounted) Navigator.pop(context, true);
            },
            onAdFailedToShowFullScreenContent: (ad, error) {
              ad.dispose();
              if (mounted) setState(() => status = "The ad could not be shown. No points were added.");
            },
          );
          await ad.show(onUserEarnedReward: (ad, reward) { earned = true; });
        },
        onAdFailedToLoad: (error) {
          if (mounted) setState(() => status = "No ad is available right now. No points were added.");
        },
      ),
    );
  }

  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: !widget.demo || left <= 0,
      child: Scaffold(
        backgroundColor: Colors.black,
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(widget.demo ? "DEMO AD" : "REWARDED AD", style: const TextStyle(color: EarnColors.gold, fontWeight: FontWeight.w800, letterSpacing: 1.4)),
                const Spacer(),
                Text(widget.demo ? "$left" : "", style: const TextStyle(color: Colors.white, fontSize: 72, fontWeight: FontWeight.w800)),
                Text(status, style: const TextStyle(color: Colors.white, fontSize: 22, height: 1.3)),
                const SizedBox(height: 12),
                Text(
                  widget.demo
                      ? "This stand-in plays while AdMob is not connected. The server still decides the points. A production build loads Google's test or live rewarded ad instead."
                      : "If this unit is Google's test ID, it is not real revenue. Points still wait for the server-side verification callback.",
                  style: const TextStyle(color: Colors.white70, height: 1.4),
                ),
                const Spacer(),
                if (!widget.demo) TextButton(onPressed: () => Navigator.pop(context), child: const Text("Close", style: TextStyle(color: Colors.white))),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

Future<void> _watch(BuildContext context) async {
  final state = AppScope.of(context);
  try {
    final prepared = await state.prepareAd();
    if (!context.mounted) return;
    await Navigator.of(context).push(MaterialPageRoute(
      fullscreenDialog: true,
      builder: (_) => AdPage(
        sessionId: prepared["sessionId"] as String,
        userId: prepared["userId"] as String,
        demo: state.config.demoMode,
      ),
    ));
    if (context.mounted) await state.refresh();
  } on ApiException catch (err) {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
  }
}

Future<void> _guard(BuildContext context, Future<void> Function() action) async {
  try {
    await action();
  } on ApiException catch (err) {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
  }
}

class _Mark extends StatelessWidget {
  const _Mark();
  @override
  Widget build(BuildContext context) {
    return Container(
      width: 56,
      height: 56,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: EarnColors.ink, borderRadius: BorderRadius.circular(18)),
      child: const Text("R", style: TextStyle(color: EarnColors.gold, fontSize: 30, fontWeight: FontWeight.w800)),
    );
  }
}

class _Card extends StatelessWidget {
  const _Card({required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(18), border: Border.all(color: EarnColors.line)),
      child: child,
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value});
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) {
    return _Card(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(label, style: const TextStyle(color: EarnColors.muted, fontSize: 12)),
      Text(value, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
    ]));
  }
}

class _Status extends StatelessWidget {
  const _Status(this.status);
  final String status;
  @override
  Widget build(BuildContext context) {
    final color = status == "PAID" ? EarnColors.green : status == "REJECTED" || status == "FROZEN" ? EarnColors.danger : const Color(0xFF8A6A12);
    return Text(status, style: TextStyle(color: color, fontWeight: FontWeight.w800, fontSize: 12));
  }
}

String _when(String iso) => iso.length >= 16 ? iso.substring(0, 16).replaceFirst("T", " ") : iso;

const _terms = """
EarnZA is a rewards preview for adults in South Africa, aged 18 or over. It is not employment, not a bank, and not a promise of income.

You may be offered points for choosing to watch a rewarded advertisement. The number of points, the Rand value, the daily limit, and the minimum cash out are set by the operator and can change. Points have no cash value until a cash-out request is accepted and paid.

Cash outs are requests. 1Voucher PINs and bank transfers are sent manually. The operator may reject a request, including for suspected fraud, and return the points.

One account is linked to one device. Emulators, rooted devices, and extra accounts may be blocked.

Advertisements are served by Google. EarnZA does not control the ads. You must follow Google's rules as a viewer.

Replace this draft with terms reviewed for South African consumer law before the app is published.
""";

const _privacy = """
This draft describes the data the first version is built to handle. It is not a POPIA-ready privacy notice.

The app and server store your name, email, password hash (or a Firebase sign-in), device identifier, whether the device looks like an emulator or is rooted, points, ad-view records, referral code, and cash-out details. Cash-out details can include a mobile number or bank account number, plus a voucher PIN or payment reference after payment.

That information is used to run accounts, prevent more than one account on a phone, credit verified ad views, and pay approved cash outs. It is not sold.

The operator, Google AdMob, and Google Firebase (when you switch them on) process data to provide ads and sign-in. You can delete the account in the app, which removes sign-in and redacts bank numbers and voucher PINs. Payment records may be kept without those details for accounting.

Replace this draft with a privacy notice reviewed for POPIA before the app is published. Put a real support email in the Help screen.
""";
