(define-constant ERR_NOT_AUTHORIZED (err u100))
(define-constant ERR_INVALID_SUBMISSION (err u101))
(define-constant ERR_ZERO_WEIGHT (err u102))
(define-constant ERR_INSUFFICIENT_BALANCE (err u103))
(define-constant ERR_ALREADY_DISTRIBUTED (err u104))
(define-constant ERR_INVALID_RATE (err u105))
(define-constant ERR_PAUSED (err u106))
(define-constant ERR_INVALID_MATERIAL (err u107))
(define-constant ERR_BATCH_LIMIT_EXCEEDED (err u108))
(define-constant ERR_EMERGENCY_WITHDRAWAL (err u109))
(define-constant REWARD_RATE u10) ;; 10 RTOK per kg of recyclables
(define-constant MAX_WEIGHT u1000000) ;; Max 1 ton per submission
(define-constant MIN_WEIGHT u100) ;; Min 100g per submission
(define-constant MAX_BATCH_SIZE u50) ;; Max 50 submissions per batch

(define-data-var contract-paused bool false)
(define-data-var total-rewards-distributed uint u0)
(define-data-var reward-rate uint REWARD_RATE)
(define-data-var max-reward-cap uint u1000000) ;; Max 1M RTOK per submission
(define-data-var emergency-admin principal tx-sender)

(define-map rewards
  { submission-id: uint }
  { household: principal, amount: uint, distributed-at: uint, material-type: (string-utf8 50), verified-by: principal })

(define-map reward-history
  { household: principal, submission-id: uint }
  { amount: uint, timestamp: uint })

(define-map material-modifiers
  { material-type: (string-utf8 50) }
  { modifier: uint }) ;; Multiplier (e.g., 120 = 1.2x for rare materials)

(define-map audit-logs
  { log-id: uint }
  { action: (string-utf8 50), caller: principal, timestamp: uint, details: (string-utf8 200) })

(define-data-var log-counter uint u0)

(define-public (distribute-rewards (submission-id uint) (household principal) (weight uint) (material-type (string-utf8 50)))
  (let
    (
      (modifier (default-to u100 (get modifier (map-get? material-modifiers { material-type: material-type }))))
      (reward-amount (/ (* weight (var-get reward-rate) modifier) u100))
      (caller tx-sender)
      (current-block block-height)
    )
    (asserts! (not (var-get contract-paused)) ERR_PAUSED)
    (asserts! (and (>= weight MIN_WEIGHT) (<= weight MAX_WEIGHT)) ERR_ZERO_WEIGHT)
    (asserts! (is-authorized-verifier caller) ERR_NOT_AUTHORIZED)
    (asserts! (is-valid-submission submission-id) ERR_INVALID_SUBMISSION)
    (asserts! (is-valid-material material-type) ERR_INVALID_MATERIAL)
    (asserts! (is-none (map-get? rewards { submission-id: submission-id })) ERR_ALREADY_DISTRIBUTED)
    (asserts! (<= reward-amount (var-get max-reward-cap)) ERR_INSUFFICIENT_BALANCE)
    (try! (contract-call? .TokenContract transfer reward-amount (as-contract tx-sender) household))
    (map-insert rewards
      { submission-id: submission-id }
      { household: household, amount: reward-amount, distributed-at: current-block, material-type: material-type, verified-by: caller })
    (map-insert reward-history
      { household: household, submission-id: submission-id }
      { amount: reward-amount, timestamp: current-block })
    (var-set total-rewards-distributed (+ (var-get total-rewards-distributed) reward-amount))
    (try! (log-action "distribute-rewards" caller (print { submission-id: submission-id, amount: reward-amount })))
    (try! (contract-call? .RecyclingLedger log-reward submission-id household reward-amount material-type))
    (ok true)))

(define-public (batch-distribute-rewards
  (submissions (list 50 { submission-id: uint, household: principal, weight: uint, material-type: (string-utf8 50) })))
  (let
    (
      (caller tx-sender)
      (current-block block-height)
    )
    (asserts! (not (var-get contract-paused)) ERR_PAUSED)
    (asserts! (<= (len submissions) MAX_BATCH_SIZE) ERR_BATCH_LIMIT_EXCEEDED)
    (asserts! (is-authorized-verifier caller) ERR_NOT_AUTHORIZED)
    (fold process-batch submissions (ok true))))

(define-public (update-reward-rate (new-rate uint))
  (begin
    (asserts! (is-eq tx-sender (contract-call? .MunicipalAuthority get-admin)) ERR_NOT_AUTHORIZED)
    (asserts! (and (> new-rate u0) (<= new-rate u100)) ERR_INVALID_RATE)
    (var-set reward-rate new-rate)
    (try! (log-action "update-reward-rate" tx-sender (print { new-rate: new-rate })))
    (ok true)))

(define-public (set-material-modifier (material-type (string-utf8 50)) (modifier uint))
  (begin
    (asserts! (is-eq tx-sender (contract-call? .MunicipalAuthority get-admin)) ERR_NOT_AUTHORIZED)
    (asserts! (and (>= modifier u50) (<= modifier u200)) ERR_INVALID_RATE) ;; 0.5x to 2x
    (map-set material-modifiers { material-type: material-type } { modifier: modifier })
    (try! (log-action "set-material-modifier" tx-sender (print { material-type: material-type, modifier: modifier })))
    (ok true)))

(define-public (toggle-pause)
  (begin
    (asserts! (is-eq tx-sender (contract-call? .MunicipalAuthority get-admin)) ERR_NOT_AUTHORIZED)
    (var-set contract-paused (not (var-get contract-paused)))
    (try! (log-action "toggle-pause" tx-sender (print { paused: (var-get contract-paused) })))
    (ok (var-get contract-paused))))

(define-public (set-max-reward-cap (new-cap uint))
  (begin
    (asserts! (is-eq tx-sender (contract-call? .MunicipalAuthority get-admin)) ERR_NOT_AUTHORIZED)
    (asserts! (> new-cap u0) ERR_INVALID_RATE)
    (var-set max-reward-cap new-cap)
    (try! (log-action "set-max-reward-cap" tx-sender (print { new-cap: new-cap })))
    (ok true)))

(define-public (emergency-withdraw (amount uint) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender (var-get emergency-admin)) ERR_NOT_AUTHORIZED)
    (asserts! (not (var-get contract-paused)) ERR_PAUSED)
    (try! (contract-call? .TokenContract transfer amount (as-contract tx-sender) recipient))
    (try! (log-action "emergency-withdraw" tx-sender (print { amount: amount, recipient: recipient })))
    (ok true)))

(define-read-only (get-reward-details (submission-id uint))
  (map-get? rewards { submission-id: submission-id }))

(define-read-only (get-reward-history (household principal) (submission-id uint))
  (map-get? reward-history { household: household, submission-id: submission-id }))

(define-read-only (get-total-rewards-distributed)
  (ok (var-get total-rewards-distributed)))

(define-read-only (get-reward-rate)
  (ok (var-get reward-rate)))

(define-read-only (is-contract-paused)
  (ok (var-get contract-paused)))

(define-read-only (get-material-modifier (material-type (string-utf8 50)))
  (ok (default-to u100 (get modifier (map-get? material-modifiers { material-type: material-type })))))

(define-read-only (get-rewards-by-household (household principal))
  (let
    (
      (submissions (contract-call? .RecyclingSubmission get-submissions-by-household household))
    )
    (ok (map get-reward-details submissions))))

(define-read-only (get-audit-log (log-id uint))
  (map-get? audit-logs { log-id: log-id }))

(define-private (is-authorized-verifier (caller principal))
  (contract-call? .MunicipalAuthority is-verifier caller))

(define-private (is-valid-submission (submission-id uint))
  (contract-call? .RecyclingSubmission is-verified submission-id))

(define-private (is-valid-material (material-type (string-utf8 50)))
  (or
    (is-eq material-type "plastic")
    (is-eq material-type "paper")
    (is-eq material-type "glass")
    (is-eq material-type "metal")))

(define-private (process-batch
  (entry { submission-id: uint, household: principal, weight: uint, material-type: (string-utf8 50) })
  (acc (response bool uint)))
  (match acc
    ok-value
    (let
      (
        (submission-id (get submission-id entry))
        (household (get household entry))
        (weight (get weight entry))
        (material-type (get material-type entry))
      )
      (match (distribute-rewards submission-id household weight material-type)
        success (ok true)
        error (err error)))
    error error))

(define-private (log-action (action (string-utf8 50)) (caller principal) (details { submission-id: uint, amount: uint }))
  (let
    (
      (log-id (var-get log-counter))
    )
    (map-insert audit-logs
      { log-id: log-id }
      { action: action, caller: caller, timestamp: block-height, details: (to-string details) })
    (var-set log-counter (+ log-id u1))
    (ok true)))

(define-private (log-action-simple (action (string-utf8 50)) (caller principal) (details (string-utf8 200)))
  (let
    (
      (log-id (var-get log-counter))
    )
    (map-insert audit-logs
      { log-id: log-id }
      { action: action, caller: caller, timestamp: block-height, details: details })
    (var-set log-counter (+ log-id u1))
    (ok true)))